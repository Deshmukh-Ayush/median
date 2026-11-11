import { afterEach, expect, it } from "vitest"

import { setDocumentStoreForTests } from "../src/server/integrations/document-store"
import {
  adjustVendorAdvance,
  getPartyStatement,
  getPayablesAgeing,
  listBills,
  recordBillPayment,
  recordVendorAdvance,
} from "../src/server/services/bills"
import { approvedLotusBill, billsOrgSetup } from "./bill-fixture"
import { freshDevOrg } from "./setup"

afterEach(() => setDocumentStoreForTests(null))

it("bills: approval → bill, payment, advance adjusted, ageing, statement", async () => {
  const ctx = await freshDevOrg("bills")
  const { bankAccountId } = await billsOrgSetup(ctx)
  const { vendor } = await approvedLotusBill(ctx)
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
