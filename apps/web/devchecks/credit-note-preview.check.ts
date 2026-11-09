import { expect, it } from "vitest"

import { getDb } from "../src/server/db"
import { organizationSettings } from "../src/server/db/schema"
import { setRazorpayClientOptionsForTests } from "../src/server/integrations/razorpay/connector"
import { eq } from "drizzle-orm"
import { connect, syncConnection } from "../src/server/services/connectors"
import {
  createCreditNote,
  getCreditNote,
  previewCreditNote,
} from "../src/server/services/credit-notes"
import { listInboxItems } from "../src/server/services/inbox"
import { createInvoice } from "../src/server/services/invoices"
import { createParty } from "../src/server/services/parties"
import { istDateOf } from "../src/server/services/posting-rules"
import { freshDevOrg } from "./setup"

it("previewCreditNote, value credits, and refund items with their invoice", async () => {
  const ctx = await freshDevOrg("cn-preview")
  await getDb()
    .update(organizationSettings)
    .set({ gstRegistered: true, gstin: "29ABCDE1234F1Z5", stateCode: "29" })
    .where(eq(organizationSettings.organizationId, ctx.orgId))
  const today = istDateOf(new Date())
  const customer = await createParty(ctx, {
    kind: "customer",
    name: "Preview Co",
    stateCode: "29",
  })
  const inv = await createInvoice(ctx, {
    partyId: customer.id,
    invoiceDate: today,
    dueDate: today,
    lines: [
      {
        description: "Seats",
        hsnSac: "998314",
        quantity: "10",
        unitPrice: 1_000_00n,
        gstRateBps: 1800,
      },
      {
        description: "Training",
        hsnSac: "999293",
        quantity: "1",
        unitPrice: 2_000_00n,
        gstRateBps: 500,
      },
    ],
  })
  const input = {
    invoiceId: inv.id,
    creditNoteDate: today,
    reason: "post_sale_discount" as const,
    lines: [
      { invoiceLineId: inv.lines[0]!.id, quantity: "2" },
      { invoiceLineId: inv.lines[1]!.id, taxable: 500_00n },
    ],
  }

  // Preview = what create issues, and nothing is saved.
  const preview = await previewCreditNote(ctx, input)
  const again = await previewCreditNote(ctx, input)
  expect(again.nextNumber).toBe(preview.nextNumber)
  const note = await createCreditNote(ctx, input)
  expect(note.number).toBe(preview.nextNumber)
  expect({
    taxable: note.taxable,
    cgst: note.cgst,
    sgst: note.sgst,
    roundOff: note.roundOff,
    total: note.total,
  }).toEqual({
    taxable: preview.taxable,
    cgst: preview.cgst,
    sgst: preview.sgst,
    roundOff: preview.roundOff,
    total: preview.total,
  })
  expect(preview.invoice.outstandingAfter).toBe(inv.total - note.total)

  // A credit by value has no quantity.
  const saved = await getCreditNote(ctx, note.id)
  expect(saved?.lines.map((l) => l.quantity)).toEqual(["2", null])
  expect(preview.lines.map((l) => l.quantity)).toEqual(["2", null])

  // A part refund of a two-rate invoice can't be split safely: it goes to
  // the inbox, carrying the invoice it's for.
  const run = `pv${Date.now()}`
  const now = Math.floor(Date.now() / 1000)
  const payment = {
    id: `pay_${run}`,
    entity: "payment",
    amount: Number(inv.total - note.total),
    currency: "INR",
    status: "captured",
    order_id: null,
    invoice_id: null,
    method: "upi",
    amount_refunded: 1_000_00,
    captured: true,
    description: null,
    email: null,
    contact: null,
    notes: { invoice_number: inv.number },
    fee: 0,
    tax: 0,
    created_at: now - 120,
  }
  const refund = {
    id: `rfnd_${run}`,
    entity: "refund",
    amount: 1_000_00,
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
  await syncConnection(ctx, conn.id)
  const inbox = await listInboxItems(ctx, null, { kind: "razorpay_record" })
  const item = inbox.items.find((i) => i.refund)
  console.log("refund item", item?.reason, item?.refund)
  expect(item?.refund).toEqual({
    invoiceId: inv.id,
    invoiceNumber: inv.number,
    amount: 1_000_00n,
  })
})
