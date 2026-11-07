// Posting rules on SourceRecords (accounting rules 8–11). Pure and
// deterministic: the sync runner loads the context, calls a rule, and posts
// or files the decision. Every connector gets these rules because they read
// only SourceRecords, never provider APIs.
//
// High-confidence matches post; everything else becomes an inbox proposal.
// Amounts are integer paise; nothing here estimates or rounds beyond the
// ledger's GST helpers.

import type {
  InboxGstSplit,
  InboxItemKind,
  InboxTds,
  ProposedEntry,
  ProposedLine,
  TdsSection,
} from "@workspace/contracts"
import {
  formatInr,
  matchTdsReceipt,
  paise,
  splitInclusive,
  splitTax,
} from "@workspace/ledger"
import type { Money, ResolvedGstRate } from "@workspace/ledger"
import { z } from "zod"

export interface RuleAccounts {
  readonly clearing: string
  readonly bank: string
  readonly revenue: string
  readonly outputCgst: string
  readonly outputSgst: string
  readonly outputIgst: string
  readonly inputCgst: string
  readonly inputSgst: string
  readonly inputIgst: string
  readonly gatewayCharges: string
  readonly receivables: string
  readonly tdsReceivable: string
  readonly suspense: string
  readonly payables: string
}

export interface RuleOrg {
  readonly gstRegistered: boolean
  readonly compositionScheme: boolean
  /** Two-digit GST state code; null until the GST profile is filled in. */
  readonly stateCode: string | null
}

/** A stored source record, as the rules see it. */
export interface RuleRecord {
  readonly id: string
  readonly kind: string
  readonly externalId: string | null
  readonly occurredAt: Date
  readonly amountPaise: bigint
  readonly settlementExternalId: string | null
  readonly payload: unknown
}

export type Decision =
  | {
      readonly action: "post"
      readonly entry: ProposedEntry
      readonly reversesEntryId?: string | null
      /** Line dimensions to store, by line index (e.g. the GST rate). */
      readonly dimensions?: Readonly<Record<number, Record<string, string>>>
      /** The invoice this receipt pays: applied when the entry posts. */
      readonly invoiceId?: string | null
    }
  | {
      readonly action: "inbox"
      readonly kind: InboxItemKind
      readonly entry: ProposedEntry
      readonly reason: string
      readonly confidence: number
      readonly gst: InboxGstSplit | null
      readonly tds: InboxTds | null
      /** The invoice this receipt pays: applied when it's approved. */
      readonly invoiceId?: string | null
    }
  /**
   * Rule 10: a refund of an invoiced sale. Book a credit note against the
   * invoice, then the payout `entry` (Dr receivable, Cr clearing). If that
   * can't be done safely, `entry` goes to the inbox with `reason`.
   */
  | {
      readonly action: "credit_note"
      readonly invoiceNumber: string
      readonly reference: string
      readonly entry: ProposedEntry
      readonly reason: string
    }
  /** Not final yet (e.g. a pending refund); looked at again next sync. */
  | { readonly action: "wait"; readonly reason: string }
  /** Nothing to book (failed payment). */
  | { readonly action: "ignore"; readonly reason: string }

/**
 * Default GST state Razorpay bills its fees from: Karnataka (29), giving
 * CGST+SGST for Karnataka merchants and IGST for the rest. Each connection
 * can override it (connections.fee_gst_state_code); the CA should verify it
 * against Razorpay's tax invoice.
 */
export const DEFAULT_RAZORPAY_FEE_GST_STATE = "29"

const ZERO = paise(0n)

/** IST calendar date of a timestamp. */
export function istDateOf(at: Date): string {
  return new Date(at.getTime() + 19_800_000).toISOString().slice(0, 10)
}

function dr(
  accountId: string,
  amount: Money,
  description: string | null = null,
  partyId: string | null = null
): ProposedLine {
  return { accountId, partyId, debit: amount, credit: ZERO, description }
}
function cr(
  accountId: string,
  amount: Money,
  description: string | null = null,
  partyId: string | null = null
): ProposedLine {
  return { accountId, partyId, debit: ZERO, credit: amount, description }
}
const nonZero = (lines: ProposedLine[]) =>
  lines.filter((l) => l.debit !== 0n || l.credit !== 0n)

const chargesGst = (org: RuleOrg) => org.gstRegistered && !org.compositionScheme

// ---------------------------------------------------------------------------
// Payload shapes (written by the connectors; see razorpay/records.ts)

const notesSchema = z.record(z.string(), z.unknown()).catch({})
const paymentPayloadSchema = z.looseObject({
  captured: z.boolean().optional(),
  status: z.string().optional(),
  notes: notesSchema.optional(),
})
const feePayloadSchema = z.looseObject({
  fee: z.int().nonnegative(),
  tax: z.int().nonnegative(),
})
const refundPayloadSchema = z.looseObject({
  payment_id: z.string().optional(),
  status: z.string().optional(),
})
const settlementPayloadSchema = z.looseObject({
  status: z.string().optional(),
  recon: z.enum(["available", "unavailable"]).optional(),
})

/** Mapping key a payment carries in its notes (rule 8): product, then stream. */
export function paymentMappingKey(
  payload: unknown
): { kind: "product" | "stream"; key: string } | null {
  const notes = paymentPayloadSchema.safeParse(payload).data?.notes ?? {}
  const product = notes["product"]
  const stream = notes["stream"]
  if (typeof product === "string" && product.trim() !== "")
    return { kind: "product", key: product.trim() }
  if (typeof stream === "string" && stream.trim() !== "")
    return { kind: "stream", key: stream.trim() }
  return null
}

/** Our invoice number a payment says it pays (notes.invoice_number). */
export function paymentInvoiceNumber(payload: unknown): string | null {
  const notes = paymentPayloadSchema.safeParse(payload).data?.notes ?? {}
  const n = notes["invoice_number"]
  return typeof n === "string" && n.trim() !== "" ? n.trim() : null
}

// ---------------------------------------------------------------------------
// Rule 8: payments with no invoice (GST-inclusive)

export interface OpenInvoice {
  readonly id: string
  readonly number: string
  readonly partyId: string
  readonly total: Money
  readonly taxable: Money
  /** total − paid − credited. Receipts are matched against this. */
  readonly outstanding: Money
}

export function paymentRule(
  record: RuleRecord,
  ctx: {
    readonly accounts: RuleAccounts
    readonly org: RuleOrg
    /** resolveGstRate for this payment's supply date. */
    readonly rate: ResolvedGstRate
    /** The invoice the payment says it pays, if found and open. */
    readonly invoice: OpenInvoice | null
  }
): Decision {
  const p = paymentPayloadSchema.safeParse(record.payload).data ?? {}
  if (p.status === "failed")
    return { action: "ignore", reason: "Failed payment" }
  if (
    p.captured === false ||
    (p.captured === undefined && p.status !== "captured")
  )
    return { action: "wait", reason: "Not captured yet" }

  const amount = paise(record.amountPaise)
  const entryDate = istDateOf(record.occurredAt)
  const ref = record.externalId ?? record.id
  const { accounts, org } = ctx

  if (ctx.invoice)
    return receiptRule(amount, ctx.invoice, {
      accounts,
      debitAccountId: accounts.clearing,
      entryDate,
      reference: ref,
      kind: "razorpay_record",
    })

  const allRevenue: ProposedEntry = {
    entryDate,
    narration: `Razorpay payment ${ref}`,
    lines: [dr(accounts.clearing, amount), cr(accounts.revenue, amount)],
  }
  if (!chargesGst(org) || ctx.rate.status === "not_registered")
    return { action: "post", entry: allRevenue }

  if (ctx.rate.status === "inbox") {
    return {
      action: "inbox",
      kind: "razorpay_record",
      entry: allRevenue,
      reason:
        ctx.rate.reason === "ambiguous"
          ? `Payment ${ref}: more than one GST rate applies on ${entryDate}. Choose the rate before approving.`
          : `Payment ${ref}: no GST rate for ${entryDate}. Add a product/stream mapping or a default rate, or set the GST split here.`,
      confidence: 0.5,
      gst: null,
      tds: null,
    }
  }
  if (org.stateCode === null) {
    return {
      action: "inbox",
      kind: "razorpay_record",
      entry: allRevenue,
      reason: `Payment ${ref}: add your GST state in Settings so GST can be split.`,
      confidence: 0.5,
      gst: null,
      tds: null,
    }
  }

  // B2C with unknown place of supply: the org's state (rule 6) → intrastate.
  const { taxable, gst } = splitInclusive(amount, ctx.rate.rateBps)
  const split = splitTax(gst, true)
  const lines = [
    dr(accounts.clearing, amount),
    cr(accounts.revenue, taxable),
    cr(accounts.outputCgst, split.cgst, "CGST"),
    cr(accounts.outputSgst, split.sgst, "SGST"),
  ]
  return {
    action: "post",
    entry: {
      entryDate,
      narration: `Razorpay payment ${ref}`,
      lines: nonZero(lines),
    },
    dimensions: { 1: { gst_rate_bps: String(ctx.rate.rateBps) } },
  }
}

// ---------------------------------------------------------------------------
// Rule 9: gateway fees, as Razorpay returns them

export function feeRule(
  record: RuleRecord,
  ctx: {
    readonly accounts: RuleAccounts
    readonly org: RuleOrg
    /** The connection's setting; null → DEFAULT_RAZORPAY_FEE_GST_STATE. */
    readonly feeGstStateCode?: string | null
  }
): Decision {
  const f = feePayloadSchema.safeParse(record.payload)
  const amount = paise(record.amountPaise)
  const entryDate = istDateOf(record.occurredAt)
  const ref = record.externalId ?? record.id
  const { accounts, org } = ctx
  const narration = `Razorpay fee on ${ref.replace(/:fee$/, "")}`
  if (
    !f.success ||
    BigInt(f.data.fee) !== record.amountPaise ||
    f.data.tax > f.data.fee
  ) {
    return {
      action: "inbox",
      kind: "razorpay_record",
      entry: {
        entryDate,
        narration,
        lines: [
          dr(accounts.gatewayCharges, amount),
          cr(accounts.clearing, amount),
        ],
      },
      reason: `Fee ${ref}: Razorpay's fee and tax fields don't add up. Check before approving.`,
      confidence: 0.4,
      gst: null,
      tds: null,
    }
  }
  const tax = paise(BigInt(f.data.tax))
  // Unregistered and composition businesses can't claim input tax credit.
  if (!chargesGst(org) || tax === 0n) {
    return {
      action: "post",
      entry: {
        entryDate,
        narration,
        lines: [
          dr(accounts.gatewayCharges, amount),
          cr(accounts.clearing, amount),
        ],
      },
    }
  }
  if (org.stateCode === null) {
    return {
      action: "inbox",
      kind: "razorpay_record",
      entry: {
        entryDate,
        narration,
        lines: [
          dr(accounts.gatewayCharges, paise(amount - tax)),
          dr(accounts.inputIgst, tax, "IGST"),
          cr(accounts.clearing, amount),
        ],
      },
      reason: `Fee ${ref}: add your GST state in Settings to book input GST correctly.`,
      confidence: 0.5,
      gst: null,
      tds: null,
    }
  }
  const feeState = ctx.feeGstStateCode ?? DEFAULT_RAZORPAY_FEE_GST_STATE
  const split = splitTax(tax, org.stateCode === feeState)
  return {
    action: "post",
    entry: {
      entryDate,
      narration,
      lines: nonZero([
        dr(accounts.gatewayCharges, paise(amount - tax)),
        dr(accounts.inputCgst, split.cgst, "CGST"),
        dr(accounts.inputSgst, split.sgst, "SGST"),
        dr(accounts.inputIgst, split.igst, "IGST"),
        cr(accounts.clearing, amount),
      ]),
    },
  }
}

// ---------------------------------------------------------------------------
// Rule 10: refunds

export interface OriginalPayment {
  readonly externalId: string
  readonly amountPaise: bigint
  readonly status: "new" | "posted" | "inbox" | "ignored"
  /** Set when posted. */
  readonly entryId: string | null
  readonly lines: readonly {
    readonly accountId: string
    readonly partyId: string | null
    readonly debit: bigint
    readonly credit: bigint
    readonly dimensions: Readonly<Record<string, string>> | null
  }[]
  /** Our invoice number the payment quoted (notes.invoice_number). */
  readonly invoiceNumber: string | null
}

export function refundRule(
  record: RuleRecord,
  ctx: {
    readonly accounts: RuleAccounts
    readonly original: OriginalPayment | null
    /** Refunds of this payment already posted, excluding this one. */
    readonly refundedBefore: bigint
  }
): Decision {
  const r = refundPayloadSchema.safeParse(record.payload).data ?? {}
  if (r.status === "failed")
    return { action: "ignore", reason: "Failed refund" }
  if (r.status !== undefined && r.status !== "processed")
    return { action: "wait", reason: "Refund not processed yet" }

  const { accounts, original } = ctx
  const amount = paise(record.amountPaise)
  const entryDate = istDateOf(record.occurredAt)
  const ref = record.externalId ?? record.id
  const narration = `Razorpay refund ${ref}${original ? ` of ${original.externalId}` : ""}`
  const plain: ProposedEntry = {
    entryDate,
    narration,
    lines: [dr(accounts.revenue, amount), cr(accounts.clearing, amount)],
  }
  const toInbox = (reason: string, confidence = 0.5): Decision => ({
    action: "inbox",
    kind: "razorpay_record",
    entry: plain,
    reason,
    confidence,
    gst: null,
    tds: null,
  })

  if (!original)
    return toInbox(
      `Refund ${ref} is for a payment Median hasn't imported.`,
      0.4
    )
  if (original.status === "new")
    return { action: "wait", reason: "Payment not booked yet" }
  if (original.status !== "posted" || !original.entryId)
    return toInbox(
      `Refund ${ref}: payment ${original.externalId} is still in the inbox. Approve it first.`
    )
  if (ctx.refundedBefore + record.amountPaise > original.amountPaise)
    return toInbox(
      `Refund ${ref} is more than what's left of payment ${original.externalId}.`,
      0.3
    )

  // Rule 10: the payment settled one of our invoices (it credited the
  // customer's receivable), so the refund is a credit note against it.
  const receipt = original.lines.find(
    (l) => l.accountId === accounts.receivables && l.credit > 0n && l.partyId
  )
  if (original.invoiceNumber && receipt?.partyId) {
    return {
      action: "credit_note",
      invoiceNumber: original.invoiceNumber,
      reference: ref,
      entry: {
        entryDate,
        narration,
        lines: [
          dr(accounts.receivables, amount, null, receipt.partyId),
          cr(accounts.clearing, amount),
        ],
      },
      reason: `Refund ${ref} is for invoice ${original.invoiceNumber}: create a credit note for it, then approve this payout (rule 10).`,
    }
  }

  // Full refund with nothing refunded before: reverse the payment entry.
  if (
    record.amountPaise === original.amountPaise &&
    ctx.refundedBefore === 0n
  ) {
    return {
      action: "post",
      reversesEntryId: original.entryId,
      entry: {
        entryDate,
        narration,
        lines: original.lines.map((l) => ({
          accountId: l.accountId,
          partyId: l.partyId,
          debit: paise(l.credit),
          credit: paise(l.debit),
          description: null,
        })),
      },
    }
  }

  // Partial refund: reverse that share at the payment's rate.
  const revenueLine = original.lines.find(
    (l) => l.dimensions?.["gst_rate_bps"] !== undefined
  )
  const hadGst = original.lines.some((l) =>
    [accounts.outputCgst, accounts.outputSgst, accounts.outputIgst].includes(
      l.accountId
    )
  )
  if (!revenueLine && hadGst)
    return toInbox(
      `Refund ${ref}: the GST rate on payment ${original.externalId} isn't recorded. Set the GST split before approving.`
    )
  const rate = Number(revenueLine?.dimensions?.["gst_rate_bps"] ?? "0")
  const revenueAccount = revenueLine?.accountId ?? accounts.revenue
  const hadIgst = original.lines.some(
    (l) => l.accountId === accounts.outputIgst
  )
  const { taxable, gst } = splitInclusive(amount, rate)
  const split = splitTax(gst, !hadIgst)
  return {
    action: "post",
    entry: {
      entryDate,
      narration,
      lines: nonZero([
        dr(revenueAccount, taxable),
        dr(accounts.outputCgst, split.cgst, "CGST"),
        dr(accounts.outputSgst, split.sgst, "SGST"),
        dr(accounts.outputIgst, split.igst, "IGST"),
        cr(accounts.clearing, amount),
      ]),
    },
  }
}

// ---------------------------------------------------------------------------
// Settlements: matched through the Razorpay Clearing account

export interface SettlementTotals {
  readonly payments: bigint
  readonly fees: bigint
  readonly refunds: bigint
  /** Records linked to this settlement. */
  readonly count: number
}

export function settlementRule(
  record: RuleRecord,
  ctx: { readonly accounts: RuleAccounts; readonly linked: SettlementTotals }
): Decision {
  const s = settlementPayloadSchema.safeParse(record.payload).data ?? {}
  if (s.status === "failed")
    return { action: "ignore", reason: "Failed settlement" }
  if (s.status !== undefined && s.status !== "processed")
    return { action: "wait", reason: "Settlement not processed yet" }

  const { accounts, linked } = ctx
  const amount = paise(record.amountPaise)
  const entryDate = istDateOf(record.occurredAt)
  const ref = record.externalId ?? record.id
  const entry: ProposedEntry = {
    entryDate,
    narration: `Razorpay settlement ${ref}`,
    lines: [dr(accounts.bank, amount), cr(accounts.clearing, amount)],
  }
  if (s.recon !== "available" || linked.count === 0) {
    return {
      action: "inbox",
      kind: "settlement_gap",
      entry,
      reason: `Settlement ${ref} of ${formatInr(amount)} couldn't be reconciled: Razorpay's settlement recon wasn't available, so its payments are unknown. Check it against the Razorpay dashboard.`,
      confidence: 0.4,
      gst: null,
      tds: null,
    }
  }
  const expected = linked.payments - linked.fees - linked.refunds
  if (expected === record.amountPaise) return { action: "post", entry }
  const gap: bigint = expected - record.amountPaise
  return {
    action: "inbox",
    kind: "settlement_gap",
    entry,
    reason: `Settlement ${ref} is ${formatInr(paise(gap < 0n ? -gap : gap))} ${gap > 0n ? "less" : "more"} than its payments minus fees and refunds (${formatInr(paise(expected))}). The difference stays in Razorpay clearing until explained.`,
    confidence: 0.6,
    gst: null,
    tds: null,
  }
}

// ---------------------------------------------------------------------------
// Rule 11: receipts against an invoice, with TDS

/** Usual section for each TDS rate on receipts; the reviewer confirms. */
const TDS_SECTION_FOR_RATE: Readonly<Record<number, TdsSection>> = {
  100: "194C",
  200: "194J",
  1000: "194J",
}

export function receiptRule(
  received: Money,
  invoice: OpenInvoice,
  ctx: {
    readonly accounts: RuleAccounts
    /** Clearing for gateway receipts, the bank account for bank lines. */
    readonly debitAccountId: string
    readonly entryDate: string
    readonly reference: string
    readonly kind: InboxItemKind
  }
): Decision {
  const { accounts } = ctx
  const narration = `Receipt against ${invoice.number} (${ctx.reference})`
  const invoiceId = invoice.id
  if (received === invoice.outstanding) {
    return {
      action: "post",
      invoiceId,
      entry: {
        entryDate: ctx.entryDate,
        narration,
        lines: [
          dr(ctx.debitAccountId, received),
          cr(accounts.receivables, received, null, invoice.partyId),
        ],
      },
    }
  }
  // TDS is deducted on the whole invoice, so only an untouched one fits.
  const tds =
    invoice.outstanding === invoice.total
      ? matchTdsReceipt({
          received,
          invoiceTotal: invoice.total,
          taxable: invoice.taxable,
        })
      : null
  if (tds) {
    const section = TDS_SECTION_FOR_RATE[tds.rateBps] ?? "194J"
    return {
      action: "inbox",
      kind: ctx.kind,
      entry: {
        entryDate: ctx.entryDate,
        narration: `${narration}, TDS ${section}`,
        lines: [
          dr(ctx.debitAccountId, received),
          dr(
            accounts.tdsReceivable,
            tds.tds,
            `TDS ${section} @ ${tds.rateBps / 100}%`,
            invoice.partyId
          ),
          cr(accounts.receivables, invoice.total, null, invoice.partyId),
        ],
      },
      reason: `${formatInr(received)} is ${formatInr(tds.tds)} short of ${invoice.number}: looks like ${tds.rateBps / 100}% TDS. Confirm the section (${section} assumed) before approving.`,
      confidence: 0.75,
      gst: null,
      tds: { section, rateBps: tds.rateBps, amount: tds.tds },
      invoiceId,
    }
  }
  return {
    action: "inbox",
    kind: ctx.kind,
    entry: {
      entryDate: ctx.entryDate,
      narration,
      lines: [
        dr(ctx.debitAccountId, received),
        cr(accounts.receivables, received, null, invoice.partyId),
      ],
    },
    reason: `${formatInr(received)} doesn't match ${invoice.number} (${formatInr(invoice.outstanding)} outstanding), even after TDS at 1%, 2% or 10%.`,
    confidence: 0.4,
    gst: null,
    tds: null,
    invoiceId,
  }
}

// ---------------------------------------------------------------------------
// Bank lines: deterministic matching (amount + date window + reference)

export interface SettlementCandidate {
  readonly externalId: string
  readonly status: "new" | "posted" | "inbox" | "ignored"
  readonly entryId: string | null
  /** The bank account the settlement entry debited; null → accounts.bank. */
  readonly bankAccountId: string | null
}

export interface VendorCandidate {
  readonly partyId: string
  readonly name: string
}

export type BankMatch =
  | { readonly kind: "settlement"; readonly settlement: SettlementCandidate }
  | { readonly kind: "invoice"; readonly invoice: OpenInvoice }
  | { readonly kind: "vendor"; readonly vendor: VendorCandidate }
  /** Several candidates fit equally: never guess. */
  | { readonly kind: "ambiguous"; readonly what: string }
  | { readonly kind: "none" }

export type BankDecision =
  | Decision
  /** The money movement is already booked (the settlement entry). */
  | { readonly action: "link"; readonly entryId: string }

export function bankLineRule(
  record: RuleRecord & {
    readonly direction: "inflow" | "outflow"
    readonly reference: string | null
  },
  ctx: {
    readonly accounts: RuleAccounts
    readonly suspense: string
    readonly payables: string
    /** The ledger account of this bank connection. */
    readonly bankAccountId: string
    readonly match: BankMatch
  }
): BankDecision {
  const { accounts, bankAccountId, match } = ctx
  const amount = paise(record.amountPaise)
  const entryDate = istDateOf(record.occurredAt)
  const p = z
    .looseObject({ description: z.string().optional() })
    .safeParse(record.payload).data
  const narration = (p?.description ?? "Bank line").slice(0, 200)
  const inflow = record.direction === "inflow"
  const inbox = (
    entry: ProposedEntry,
    reason: string,
    confidence: number
  ): Decision => ({
    action: "inbox",
    kind: "bank_line",
    entry,
    reason,
    confidence,
    gst: null,
    tds: null,
  })

  if (match.kind === "settlement" && inflow) {
    const s = match.settlement
    // Settlements post Dr <settlement bank> / Cr Razorpay clearing. If this
    // statement is for another bank account, move it across.
    const settledTo = s.bankAccountId ?? accounts.bank
    const transfer: ProposedEntry = {
      entryDate,
      narration: `Razorpay settlement ${s.externalId} received`,
      lines: [dr(bankAccountId, amount), cr(settledTo, amount)],
    }
    if (s.status === "posted" && s.entryId) {
      if (bankAccountId === settledTo)
        return { action: "link", entryId: s.entryId }
      return { action: "post", entry: transfer }
    }
    return inbox(
      transfer,
      `Credit matches Razorpay settlement ${s.externalId}, which is waiting in the inbox. Approve the settlement first.`,
      0.7
    )
  }
  if (match.kind === "invoice" && inflow) {
    return receiptRule(amount, match.invoice, {
      accounts,
      debitAccountId: bankAccountId,
      entryDate,
      reference: record.reference ?? narration,
      kind: "bank_line",
    })
  }
  if (match.kind === "vendor" && !inflow) {
    return inbox(
      {
        entryDate,
        narration: `Payment to ${match.vendor.name}: ${narration}`,
        lines: [
          dr(ctx.payables, amount, null, match.vendor.partyId),
          cr(bankAccountId, amount),
        ],
      },
      `Looks like a payment to ${match.vendor.name}. Check which bill it settles.`,
      0.75
    )
  }
  const reason =
    match.kind === "ambiguous"
      ? `${formatInr(amount)} could be ${match.what}. Pick the right one.`
      : `No match for this ${inflow ? "credit" : "debit"} of ${formatInr(amount)}. Choose the account.`
  return inbox(
    {
      entryDate,
      narration,
      lines: inflow
        ? [dr(bankAccountId, amount), cr(ctx.suspense, amount)]
        : [dr(ctx.suspense, amount), cr(bankAccountId, amount)],
    },
    reason,
    match.kind === "ambiguous" ? 0.5 : 0.3
  )
}

/** Uppercase letters and digits only, for matching names and numbers in narrations. */
export function normalizeForMatch(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

/**
 * Picks the bank line's match. Order: a Razorpay settlement (amount within
 * −1/+5 days, UTR in the narration wins), then an invoice (number in the
 * narration, else a unique amount or TDS match), then a known vendor named
 * in the narration.
 */
export function findBankMatch(
  line: {
    readonly direction: "inflow" | "outflow"
    readonly amountPaise: bigint
    readonly date: string
    readonly text: string
  },
  candidates: {
    readonly settlements: readonly (SettlementCandidate & {
      readonly amountPaise: bigint
      readonly date: string
      readonly utr: string | null
    })[]
    readonly invoices: readonly (OpenInvoice & { readonly date: string })[]
    readonly vendors: readonly VendorCandidate[]
  }
): BankMatch {
  const text = normalizeForMatch(line.text)
  const daysBetween = (a: string, b: string) =>
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000
  if (line.direction === "inflow") {
    const settlements = candidates.settlements.filter((s) => {
      const lag = daysBetween(s.date, line.date)
      return s.amountPaise === line.amountPaise && lag >= -1 && lag <= 5
    })
    const byUtr = settlements.filter(
      (s) => s.utr && text.includes(normalizeForMatch(s.utr))
    )
    const [onlyUtr] = byUtr
    if (byUtr.length === 1 && onlyUtr)
      return { kind: "settlement", settlement: onlyUtr }
    const [onlyS] = settlements
    if (settlements.length === 1 && onlyS)
      return { kind: "settlement", settlement: onlyS }
    if (settlements.length > 1)
      return {
        kind: "ambiguous",
        what: `one of ${settlements.length} Razorpay settlements`,
      }

    const eligible = candidates.invoices.filter((i) => i.date <= line.date)
    const byNumber = eligible.filter((i) => {
      const n = normalizeForMatch(i.number)
      return n.length >= 3 && text.includes(n)
    })
    const [onlyN] = byNumber
    if (byNumber.length === 1 && onlyN)
      return { kind: "invoice", invoice: onlyN }
    const received = paise(line.amountPaise)
    const byAmount = eligible.filter(
      (i) =>
        i.outstanding === received ||
        (i.outstanding === i.total &&
          matchTdsReceipt({
            received,
            invoiceTotal: i.total,
            taxable: i.taxable,
          }) !== null)
    )
    const [onlyA] = byAmount
    if (byAmount.length === 1 && onlyA)
      return { kind: "invoice", invoice: onlyA }
    if (byAmount.length > 1)
      return {
        kind: "ambiguous",
        what: `a payment for ${byAmount.length} invoices`,
      }
    return { kind: "none" }
  }
  const vendors = candidates.vendors.filter((v) => {
    const n = normalizeForMatch(v.name)
    return n.length >= 4 && text.includes(n)
  })
  const [onlyV] = vendors
  if (vendors.length === 1 && onlyV) return { kind: "vendor", vendor: onlyV }
  if (vendors.length > 1)
    return { kind: "ambiguous", what: `a payment to ${vendors.length} vendors` }
  return { kind: "none" }
}
