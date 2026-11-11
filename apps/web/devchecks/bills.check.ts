import { and, eq } from "drizzle-orm"
import { afterEach, expect, it } from "vitest"

import { getDb } from "../src/server/db"
import { ledgerAccounts, organizationSettings } from "../src/server/db/schema"
import { setDocumentStoreForTests } from "../src/server/integrations/document-store"
import {
  adjustVendorAdvance,
  getPartyStatement,
  getPayablesAgeing,
  listBills,
  recordBillPayment,
  recordVendorAdvance,
} from "../src/server/services/bills"
import { registerDocument } from "../src/server/services/documents"
import { createInboxItemFromExtraction } from "../src/server/services/extraction"
import { approveInboxItem } from "../src/server/services/inbox"
import { createParty } from "../src/server/services/parties"
import { freshDevOrg } from "./setup"

afterEach(() => setDocumentStoreForTests(null))

it("bills: approval → bill, payment, advance adjusted, ageing, statement", async () => {
  const ctx = await freshDevOrg("bills")
  const db = getDb()
  await db
    .update(organizationSettings)
    .set({
      gstRegistered: true,
      gstin: "29ABCDE1234F1ZW",
      stateCode: "29",
      compositionScheme: false,
    })
    .where(eq(organizationSettings.organizationId, ctx.orgId))
  const files = new Map<string, Blob>()
  setDocumentStoreForTests({
    put: (p, b) => (files.set(p, b), Promise.resolve({ pathname: p })),
    get: () => Promise.resolve(null),
    delete: (p) => (files.delete(p), Promise.resolve()),
    deletePrefix: () => Promise.resolve(0),
  })
  const [bank] = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.organizationId, ctx.orgId),
        eq(ledgerAccounts.code, "1110")
      )
    )
  const bankAccountId = bank!.id

  // An MSME vendor; their bill is approved from the inbox.
  const vendor = await createParty(ctx, {
    kind: "vendor",
    name: "Lotus Peak Cloud",
    gstin: "27AAPCA1234F1ZV",
    msmeCategory: "micro",
  })
  const doc = await registerDocument(ctx, {
    kind: "bill",
    file: new File([`%PDF-1.7\n% bills ${Date.now()}\n`], "bill.pdf"),
  })
  const item = await createInboxItemFromExtraction(ctx, doc.id, {
    vendor: {
      name: "Lotus Peak Cloud",
      gstin: "27AAPCA1234F1ZV",
      stateCode: "27",
    },
    billNumber: "LPC/118",
    billDate: "2026-09-01",
    dueDate: "2026-09-30",
    placeOfSupplyStateCode: "29",
    currency: "INR",
    lines: [
      {
        description: "Hosting",
        hsnSac: "998315",
        quantity: "1",
        taxableAmount: "10,000.00",
        gstRatePercent: "18",
      },
    ],
    printedTotals: {
      taxable: "10,000.00",
      cgst: null,
      sgst: null,
      igst: "1,800.00",
      total: "11,800.00",
    },
  })
  await approveInboxItem(ctx, item.id)
  const open = await listBills(ctx, null)
  expect(open.items).toHaveLength(1)
  const bill = open.items[0]!
  expect(bill).toMatchObject({
    party: { id: vendor.id },
    number: "LPC/118",
    billDate: "2026-09-01",
    dueDate: "2026-09-30",
    total: 11_800_00n,
    outstanding: 11_800_00n,
    status: "open",
  })

  // Ageing: 11,800 owed to a micro vendor on a bill > 45 days old.
  const ageing = await getPayablesAgeing(ctx, null)
  expect(ageing.totals.total).toBe(11_800_00n)
  expect(ageing.msmeOver45Days).toBe(11_800_00n)
  expect(ageing.parties.items[0]).toMatchObject({
    party: { id: vendor.id },
    openBills: 1,
    msmeCategory: "micro",
  })

  // Part payment; can't pay more than what's left.
  const paid = await recordBillPayment(ctx, {
    billId: bill.id,
    bankAccountId,
    date: "2026-10-05",
    amount: 5_000_00n,
    reference: "UTR123",
  })
  expect(paid).toMatchObject({
    outstanding: 6_800_00n,
    status: "partially_paid",
  })
  await expect(
    recordBillPayment(ctx, {
      billId: bill.id,
      bankAccountId,
      date: "2026-10-05",
      amount: 7_000_00n,
    })
  ).rejects.toMatchObject({ code: "VALIDATION" })

  // An advance, then part of it settles the rest of the bill.
  await recordVendorAdvance(ctx, {
    partyId: vendor.id,
    bankAccountId,
    date: "2026-10-10",
    amount: 10_000_00n,
  })
  const settled = await adjustVendorAdvance(ctx, {
    billId: bill.id,
    date: "2026-10-15",
    amount: 6_800_00n,
  })
  expect(settled).toMatchObject({ outstanding: 0n, status: "paid" })
  expect((await listBills(ctx, null)).items).toEqual([])
  expect((await listBills(ctx, null, { status: "all" })).items).toHaveLength(1)

  // Statement: bill −11,800; payment +5,000; advance +10,000; adjustment
  // moves 6,800 from advances to payables (net 0). Closing +3,200 = the
  // advance still held.
  const statement = await getPartyStatement(ctx, vendor.id, {
    from: "2026-09-01",
    to: "2026-10-31",
  })
  expect(statement.opening).toBe(0n)
  expect(statement.closing).toBe(3_200_00n)
  expect(statement.lines.at(-1)?.balance).toBe(3_200_00n)
  // Paged: the second page opens where the first closed.
  const p1 = await getPartyStatement(
    ctx,
    vendor.id,
    { from: "2026-09-01", to: "2026-10-31" },
    null,
    { limit: 2 }
  )
  const p2 = await getPartyStatement(
    ctx,
    vendor.id,
    { from: "2026-09-01", to: "2026-10-31" },
    p1.nextCursor,
    { limit: 2 }
  )
  expect(p2.opening).toBe(p1.closing)
  expect(p2.lines[0]?.entryId).toBe(statement.lines[2]?.entryId)
})
