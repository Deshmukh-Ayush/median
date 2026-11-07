import { and, eq } from "drizzle-orm"
import { expect, it } from "vitest"

import { getDb } from "../src/server/db"
import {
  journalLines,
  organizationSettings,
  sourceRecords,
} from "../src/server/db/schema"
import { setRazorpayClientOptionsForTests } from "../src/server/integrations/razorpay/connector"
import { connect, syncConnection } from "../src/server/services/connectors"
import {
  createCreditNote,
  getCreditNote,
  listCreditNotes,
} from "../src/server/services/credit-notes"
import { createInvoice, getInvoice } from "../src/server/services/invoices"
import { createParty } from "../src/server/services/parties"
import { devOrg } from "./setup"

async function balanced(orgId: string, entryId: string | null) {
  const lines = await getDb()
    .select({
      debit: journalLines.debitPaise,
      credit: journalLines.creditPaise,
    })
    .from(journalLines)
    .where(
      and(
        eq(journalLines.organizationId, orgId),
        eq(journalLines.entryId, entryId ?? "")
      )
    )
  const debit = lines.reduce((s, l) => s + l.debit, 0n)
  expect(debit).toBe(lines.reduce((s, l) => s + l.credit, 0n))
  return debit
}

it("credit notes: manual, and from a Razorpay refund (rule 10)", async () => {
  const ctx = await devOrg()
  const db = getDb()
  await db
    .update(organizationSettings)
    .set({
      gstRegistered: true,
      gstin: "29ABCDE1234F1Z5",
      stateCode: "29",
      compositionScheme: false,
    })
    .where(eq(organizationSettings.organizationId, ctx.orgId))
  const run = `cn${Math.floor(Date.now() / 1000)}`
  const today = new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)
  const customer = await createParty(ctx, {
    kind: "customer",
    name: `Credit ${run}`,
    stateCode: "29",
  })
  const invoice = (lines: { quantity: string; unitPrice: bigint }[]) =>
    createInvoice(ctx, {
      partyId: customer.id,
      invoiceDate: today,
      dueDate: today,
      lines: lines.map((l) => ({
        description: "Seats",
        hsnSac: "998314",
        gstRateBps: 1800 as const,
        ...l,
      })),
    })

  // Manual: return 3 of 10 seats, then a discount; can't over-credit.
  const inv = await invoice([{ quantity: "10", unitPrice: 1_000_00n }])
  const lineId = inv.lines[0]?.id ?? ""
  const cn = await createCreditNote(ctx, {
    invoiceId: inv.id,
    creditNoteDate: today,
    reason: "sales_return",
    lines: [{ invoiceLineId: lineId, quantity: "3" }],
  })
  console.log("credit note", cn.number, cn.total, cn.supplyType)
  expect(cn).toMatchObject({
    taxable: 3_000_00n,
    cgst: 270_00n,
    sgst: 270_00n,
    total: 3_540_00n,
    supplyType: "intrastate",
  })
  expect(await balanced(ctx.orgId, cn.journalEntryId)).toBe(3_540_00n)
  expect(await getInvoice(ctx, inv.id)).toMatchObject({
    credited: 3_540_00n,
    outstanding: 8_260_00n,
    status: "issued",
  })
  await expect(
    createCreditNote(ctx, {
      invoiceId: inv.id,
      creditNoteDate: today,
      reason: "post_sale_discount",
      lines: [{ invoiceLineId: lineId, taxable: 7_000_01n }],
    })
  ).rejects.toMatchObject({ code: "VALIDATION" })
  const rest = await createCreditNote(ctx, {
    invoiceId: inv.id,
    creditNoteDate: today,
    reason: "post_sale_discount",
    lines: [{ invoiceLineId: lineId, taxable: 7_000_00n }],
  })
  expect(rest.number > cn.number).toBe(true)
  expect(await getInvoice(ctx, inv.id)).toMatchObject({
    outstanding: 0n,
    status: "cancelled",
  })
  const listed = await listCreditNotes(
    ctx,
    null,
    { invoiceId: inv.id },
    { limit: 1 }
  )
  const next = await listCreditNotes(
    ctx,
    listed.nextCursor,
    { invoiceId: inv.id },
    { limit: 1 }
  )
  expect([...listed.items, ...next.items].map((n) => n.id)).toEqual([
    rest.id,
    cn.id,
  ])

  // Rule 10: pay an invoice through Razorpay, then refund part of it.
  const paidInv = await invoice([{ quantity: "1", unitPrice: 1_000_00n }])
  const now = Math.floor(Date.now() / 1000)
  const payment = {
    id: `pay_${run}`,
    entity: "payment",
    amount: 1_180_00,
    currency: "INR",
    status: "captured",
    order_id: null,
    invoice_id: null,
    method: "upi",
    amount_refunded: 590_00,
    captured: true,
    description: null,
    email: null,
    contact: null,
    notes: { invoice_number: paidInv.number },
    fee: 0,
    tax: 0,
    created_at: now - 120,
  }
  const refund = {
    id: `rfnd_${run}`,
    entity: "refund",
    amount: 590_00,
    currency: "INR",
    payment_id: payment.id,
    notes: [],
    status: "processed",
    created_at: now - 60,
  }
  setRazorpayClientOptionsForTests({
    sleep: () => Promise.resolve(),
    fetch: (req) => {
      const url = new URL(req instanceof Request ? req.url : String(req))
      const first = Number(url.searchParams.get("skip") ?? 0) === 0
      const items = !first
        ? []
        : url.pathname.endsWith("/payments")
          ? [payment]
          : url.pathname.endsWith("/refunds")
            ? [refund]
            : []
      return Promise.resolve(
        new Response(
          JSON.stringify({ entity: "collection", count: items.length, items }),
          { status: 200 }
        )
      )
    },
  })
  const conn = await connect(ctx, "razorpay-test-keys", {
    keyId: `rzp_test_${run}`,
    keySecret: "devcheck-secret-123",
  })
  const sync = await syncConnection(ctx, conn.id)
  console.log("sync", sync)
  const [rec] = await db
    .select({
      id: sourceRecords.id,
      status: sourceRecords.status,
      entryId: sourceRecords.journalEntryId,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.organizationId, ctx.orgId),
        eq(sourceRecords.externalId, refund.id)
      )
    )
  expect(rec?.status).toBe("posted")
  expect(await balanced(ctx.orgId, rec?.entryId ?? null)).toBe(590_00n)
  const notes = await listCreditNotes(ctx, null, { invoiceId: paidInv.id })
  expect(notes.items).toHaveLength(1)
  const refundNote = await getCreditNote(ctx, notes.items[0]?.id ?? "")
  console.log(
    "refund credit note",
    refundNote?.number,
    refundNote?.taxable,
    refundNote?.total
  )
  expect(refundNote).toMatchObject({
    reason: "refund",
    sourceRecordId: rec?.id,
    taxable: 500_00n,
    cgst: 45_00n,
    sgst: 45_00n,
    total: 590_00n,
  })
  expect(await getInvoice(ctx, paidInv.id)).toMatchObject({
    paid: 1_180_00n,
    credited: 590_00n,
    outstanding: 0n,
    status: "paid",
  })
})
