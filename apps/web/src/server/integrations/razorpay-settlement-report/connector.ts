import "server-only"

import type { ImportFile, SourceRecordInput } from "@workspace/contracts"
import { parseRupees } from "@workspace/ledger"
import { z } from "zod"

import type { FileConnector, ParsedFile, SettlementLink } from "../connector"
import { paymentRecords, refundRecord } from "../razorpay/records"

// Fallback until Razorpay partner OAuth is approved: the settlement
// reconciliation report CSV downloaded from the Razorpay dashboard. Produces
// the same SourceRecords as the API connector (payment, fee, refund,
// settlement), already linked to their settlements.
//
// Assumptions to confirm against a real export (flagged in the Day 2 summary):
// amounts are rupees as printed ("1,180.00"); timestamps without a zone are
// IST. Rows of other types (adjustment, transfer…) are reported as errors.

const PROVIDER = "razorpay-settlement-report"
const REQUIRED = [
  "entity_id",
  "type",
  "debit",
  "credit",
  "amount",
  "fee",
  "tax",
  "settlement_id",
  "created_at",
] as const

/** "2026-11-02 14:05:00", "02/11/2026 14:05:00", ISO, or Unix seconds → Unix seconds. */
export function parseReportTime(text: string): number | null {
  const v = text.trim()
  if (/^\d{9,11}$/.test(v)) return Number(v)
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)))
    return Math.floor(Date.parse(v) / 1000)
  const ymd = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    v
  )
  const dmy =
    /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v)
  const parts = ymd
    ? [ymd[1], ymd[2], ymd[3], ymd[4], ymd[5], ymd[6]]
    : dmy
      ? [dmy[3], dmy[2], dmy[1], dmy[4], dmy[5], dmy[6]]
      : null
  if (!parts) return null
  const [y, mo, d, h, mi, s] = parts.map((p) => Number(p ?? "0"))
  const utc = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0)
  if (Number.isNaN(utc)) return null
  return Math.floor(utc / 1000) - 19_800 // IST → UTC
}

const money = z.string().transform((v, ctx) => {
  const t = v.replaceAll(",", "").trim()
  if (t === "") return 0n
  try {
    return BigInt(parseRupees(t))
  } catch {
    ctx.addIssue({ code: "custom", message: `"${v}" isn't an amount` })
    return z.NEVER
  }
})

const rowSchema = z.object({
  entity_id: z.string().trim().min(1),
  type: z.string().trim().toLowerCase(),
  debit: money,
  credit: money,
  amount: money,
  fee: money,
  tax: money,
  settlement_id: z.string().trim(),
  settlement_utr: z.string().trim().optional(),
  created_at: z.string(),
  settled_at: z.string().optional(),
  order_id: z.string().trim().optional(),
  payment_id: z.string().trim().optional(),
  method: z.string().trim().optional(),
  currency: z.string().trim().optional(),
})

interface SettlementTotals {
  credit: bigint
  debit: bigint
  fee: bigint
  tax: bigint
  utr: string | null
  settledAt: number
}

export async function parseSettlementReport(
  file: ImportFile
): Promise<ParsedFile> {
  if (file.kind !== "text")
    return {
      records: [],
      errors: [{ index: 0, message: "Upload the CSV file." }],
    }
  // Heavy library: loaded on the server only, when a file arrives.
  const { default: Papa } = await import("papaparse")
  const parsed = Papa.parse<Record<string, string>>(file.text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replaceAll(" ", "_"),
  })
  const fields = parsed.meta.fields ?? []
  const missing = REQUIRED.filter((c) => !fields.includes(c))
  if (missing.length > 0) {
    return {
      records: [],
      errors: [
        {
          index: 0,
          message: `This doesn't look like a Razorpay settlement report (missing ${missing.join(", ")}).`,
        },
      ],
    }
  }

  const records: SourceRecordInput[] = []
  const links: SettlementLink[] = []
  const errors: { index: number; message: string }[] = []
  const settlements = new Map<string, SettlementTotals>()

  parsed.data.forEach((raw, index) => {
    const r = rowSchema.safeParse(raw)
    if (!r.success) {
      errors.push({
        index,
        message: r.error.issues[0]?.message ?? "Invalid row",
      })
      return
    }
    const row = r.data
    const createdAt = parseReportTime(row.created_at)
    const settledAt = row.settled_at ? parseReportTime(row.settled_at) : null
    if (createdAt === null) {
      errors.push({
        index,
        message: `Unreadable created_at "${row.created_at}"`,
      })
      return
    }
    const settlementId = row.settlement_id || null
    const currency = (row.currency || "INR").toUpperCase()

    if (row.type === "payment") {
      const recs = paymentRecords(PROVIDER, {
        id: row.entity_id,
        entity: "payment",
        amount: Number(row.amount),
        currency,
        status: "captured",
        order_id: row.order_id || null,
        invoice_id: null,
        method: row.method || null,
        amount_refunded: 0,
        captured: true,
        description: null,
        email: null,
        contact: null,
        notes: {},
        fee: Number(row.fee),
        tax: Number(row.tax),
        created_at: createdAt,
      })
      records.push(
        ...recs.map((x) => ({ ...x, settlementExternalId: settlementId }))
      )
    } else if (row.type === "refund") {
      records.push({
        ...refundRecord(PROVIDER, {
          id: row.entity_id,
          entity: "refund",
          amount: Number(row.amount),
          currency,
          payment_id: row.payment_id || "pay_unknown",
          notes: {},
          status: "processed",
          created_at: createdAt,
        }),
        settlementExternalId: settlementId,
      })
    } else {
      errors.push({
        index,
        message: `Row type "${row.type}" isn't supported yet; book it by hand.`,
      })
      return
    }

    if (settlementId) {
      const t = settlements.get(settlementId) ?? {
        credit: 0n,
        debit: 0n,
        fee: 0n,
        tax: 0n,
        utr: null,
        settledAt: 0,
      }
      t.credit += row.credit
      t.debit += row.debit
      t.fee += row.fee
      t.tax += row.tax
      t.utr = t.utr ?? (row.settlement_utr || null)
      t.settledAt = Math.max(t.settledAt, settledAt ?? createdAt)
      settlements.set(settlementId, t)
    }
  })

  for (const [id, t] of settlements) {
    const amount = t.credit - t.debit
    if (amount < 0n) {
      errors.push({
        index: 0,
        message: `Settlement ${id} is negative; book it by hand.`,
      })
      continue
    }
    records.push({
      provider: PROVIDER,
      kind: "settlement",
      externalId: id,
      dedupeHash: null,
      occurredAt: new Date(t.settledAt * 1000).toISOString(),
      amountPaise: amount,
      direction: "outflow",
      currency: "INR",
      reference: t.utr,
      settlementExternalId: id,
      payload: {
        id,
        status: "processed",
        fees: Number(t.fee),
        tax: Number(t.tax),
        utr: t.utr,
        recon: "available",
        source: "settlement_report",
      },
    })
  }
  return { records, settlementLinks: links, errors }
}

export const razorpaySettlementReportConnector: FileConnector = {
  info: {
    provider: PROVIDER,
    displayName: "Razorpay settlement report",
    category: "payments",
    authType: "file",
    description:
      "Upload the settlement report CSV from the Razorpay dashboard.",
    availability: "available",
    accepts: ["text/csv"],
    testModeOnly: false,
  },
  settingsSchema: z.object({
    label: z.string().trim().min(1).max(100).optional(),
  }),
  parseFile: (file) => parseSettlementReport(file),
}
