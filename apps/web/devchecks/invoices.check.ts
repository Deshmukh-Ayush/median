import { and, eq } from "drizzle-orm"
import { expect, it } from "vitest"

import { getDb } from "../src/server/db"
import {
  auditLog,
  journalLines,
  organizationSettings,
} from "../src/server/db/schema"
import { setRazorpayClientOptionsForTests } from "../src/server/integrations/razorpay/connector"
import { connect, syncConnection } from "../src/server/services/connectors"
import {
  createInvoice,
  getInvoice,
  getReceivablesAgeing,
  listInvoices,
  previewInvoice,
} from "../src/server/services/invoices"
import {
  createParty,
  findPartyByGstin,
  listParties,
} from "../src/server/services/parties"
import { devOrg } from "./setup"

it("parties, invoices, receipts and ageing", async () => {
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
  const run = `iv${Math.floor(Date.now() / 1000)}`

  // Parties
  const acme = await createParty(ctx, {
    kind: "customer",
    name: `Acme ${run}`,
    email: "ap@acme.example",
    stateCode: "27",
  })
  expect(acme).toMatchObject({ kind: "customer", stateCode: "27", gstin: null })
  await expect(
    createParty(ctx, {
      kind: "customer",
      name: "x",
      gstin: "29AAICA3918J1ZE",
      stateCode: "27",
    })
  ).rejects.toMatchObject({ code: "VALIDATION" })
  const page1 = await listParties(ctx, null, { kind: "customer" }, { limit: 1 })
  expect(page1.items).toHaveLength(1)
  if (page1.nextCursor) {
    const page2 = await listParties(
      ctx,
      page1.nextCursor,
      { kind: "customer" },
      { limit: 1 }
    )
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id)
  }
  const found = await listParties(ctx, null, { search: run })
  expect(found.items.map((p) => p.id)).toEqual([acme.id])
  expect(await findPartyByGstin(ctx, "07AAICA3918J1ZA")).toBeNull()

  // Preview: interstate (customer in 27), nothing saved
  const today = new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)
  const input = {
    partyId: acme.id,
    invoiceDate: today,
    dueDate: today,
    lines: [
      {
        description: "Growth plan",
        hsnSac: "998314",
        quantity: "1",
        unitPrice: 1_000_00n,
        gstRateBps: 1800 as const,
      },
    ],
  }
  const preview = await previewInvoice(ctx, input)
  console.log("preview", preview)
  expect(preview).toMatchObject({
    supplyType: "interstate",
    placeOfSupply: "27",
    igst: 180_00n,
    total: 1_180_00n,
  })

  // Create: posts Dr receivables / Cr revenue + IGST
  const inv = await createInvoice(ctx, input)
  console.log("invoice", inv.number, inv.status, inv.outstanding)
  expect(inv.number).toBe(preview.nextNumber)
  expect(inv).toMatchObject({
    total: 1_180_00n,
    outstanding: 1_180_00n,
    status: "issued",
  })
  const lines = await db
    .select({
      debit: journalLines.debitPaise,
      credit: journalLines.creditPaise,
    })
    .from(journalLines)
    .where(
      and(
        eq(journalLines.organizationId, ctx.orgId),
        eq(journalLines.entryId, inv.journalEntryId ?? "")
      )
    )
  expect(lines.reduce((s, l) => s + l.debit, 0n)).toBe(1_180_00n)
  expect(lines.reduce((s, l) => s + l.credit, 0n)).toBe(1_180_00n)
  const [audit] = await db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(
      and(eq(auditLog.organizationId, ctx.orgId), eq(auditLog.entityId, inv.id))
    )
  expect(audit?.action).toBe("invoice.create")
  const second = await createInvoice(ctx, input)
  expect(second.number > inv.number).toBe(true)

  const listed = await listInvoices(ctx, null, { partyId: acme.id })
  const paged = await listInvoices(
    ctx,
    null,
    { partyId: acme.id },
    { limit: 1 }
  )
  const rest = await listInvoices(
    ctx,
    paged.nextCursor,
    { partyId: acme.id },
    { limit: 1 }
  )
  expect([...paged.items, ...rest.items].map((i) => i.id)).toEqual([
    second.id,
    inv.id,
  ])
  expect(listed.items.map((i) => i.id)).toEqual([second.id, inv.id])
  const ageing = await getReceivablesAgeing(ctx, null, { limit: 100 })
  const mine = ageing.parties.items.find((p) => p.party.id === acme.id)
  console.log("ageing", ageing.totals, mine)
  expect(mine).toMatchObject({
    notDue: 2_360_00n,
    total: 2_360_00n,
    openInvoices: 2,
  })

  // A Razorpay payment quoting the invoice number pays it (rule 11).
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
    amount_refunded: 0,
    captured: true,
    description: null,
    email: null,
    contact: null,
    notes: { invoice_number: inv.number },
    fee: 0,
    tax: 0,
    created_at: now - 60,
  }
  setRazorpayClientOptionsForTests({
    sleep: () => Promise.resolve(),
    fetch: (req) => {
      const url = new URL(req instanceof Request ? req.url : String(req))
      const first = Number(url.searchParams.get("skip") ?? 0) === 0
      const items = first && url.pathname.endsWith("/payments") ? [payment] : []
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
  const paid = await getInvoice(ctx, inv.id)
  expect(paid).toMatchObject({
    paid: 1_180_00n,
    outstanding: 0n,
    status: "paid",
  })
  const after = await getReceivablesAgeing(ctx, null, { limit: 100 })
  expect(after.parties.items.find((p) => p.party.id === acme.id)).toMatchObject(
    {
      total: 1_180_00n,
      openInvoices: 1,
    }
  )

  // Vendors can't be invoiced; locked or invalid input is rejected.
  const vendor = await createParty(ctx, {
    kind: "vendor",
    name: `Vendor ${run}`,
  })
  await expect(
    createInvoice(ctx, { ...input, partyId: vendor.id })
  ).rejects.toMatchObject({ code: "VALIDATION" })
  await expect(
    createInvoice({ ...ctx, role: "investor" }, input)
  ).rejects.toMatchObject({ code: "FORBIDDEN" })
})
