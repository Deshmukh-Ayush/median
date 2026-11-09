import { and, eq } from "drizzle-orm"
import { expect, it } from "vitest"
import { paise } from "@workspace/ledger"
import { getDb } from "../src/server/db"
import { ledgerAccounts, organizationSettings } from "../src/server/db/schema"
import { connect, importFile } from "../src/server/services/connectors"
import { createCreditNote } from "../src/server/services/credit-notes"
import { createInvoice } from "../src/server/services/invoices"
import { postManualEntry } from "../src/server/services/ledger"
import { createParty } from "../src/server/services/parties"
import { istDateOf } from "../src/server/services/posting-rules"
import {
  getCashPosition,
  getRevenueBreakdown,
} from "../src/server/services/revenue-cash"
import { freshDevOrg } from "./setup"

it("revenue by customer and stream, and the cash position", async () => {
  const ctx = await freshDevOrg("revcash")
  const db = getDb()
  await db
    .update(organizationSettings)
    .set({ gstRegistered: true, gstin: "29ABCDE1234F1Z5", stateCode: "29" })
    .where(eq(organizationSettings.organizationId, ctx.orgId))
  const accounts = await db
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.organizationId, ctx.orgId)))
  const id = (code: string) => accounts.find((a) => a.code === code)!.id
  const today = istDateOf(new Date())
  const month = `${today.slice(0, 7)}-01`

  const big = await createParty(ctx, {
    kind: "customer",
    name: "Big Co",
    stateCode: "29",
  })
  const small = await createParty(ctx, {
    kind: "customer",
    name: "Small Co",
    stateCode: "29",
  })
  const sell = (partyId: string, unitPrice: bigint) =>
    createInvoice(ctx, {
      partyId,
      invoiceDate: today,
      dueDate: today,
      lines: [
        {
          description: "Plan",
          hsnSac: "998314",
          quantity: "1",
          unitPrice,
          gstRateBps: 1800,
        },
      ],
    })
  const inv = await sell(big.id, 50_000_00n)
  await sell(big.id, 10_000_00n)
  await sell(small.id, 20_000_00n)
  await createCreditNote(ctx, {
    invoiceId: inv.id,
    creditNoteDate: today,
    reason: "post_sale_discount",
    lines: [{ invoiceLineId: inv.lines[0]!.id, taxable: 5_000_00n }],
  })
  // Revenue with no customer: a manual entry to Subscription revenue.
  await postManualEntry(ctx, {
    entryDate: today,
    narration: "Cash sale",
    lines: [
      { accountId: id("1110"), debit: paise(3_000_00n), credit: paise(0n) },
      { accountId: id("4100"), debit: paise(0n), credit: paise(3_000_00n) },
    ],
  })

  const r1 = await getRevenueBreakdown(ctx, month, today, null, { limit: 1 })
  expect(r1.total).toBe(78_000_00n)
  expect(r1.byCustomer).toEqual([
    {
      party: { id: big.id, name: "Big Co", gstin: null },
      invoiceCount: 2,
      revenue: 55_000_00n,
    },
  ])
  const r2 = await getRevenueBreakdown(ctx, month, today, r1.nextCursor, {
    limit: 1,
  })
  expect(r2.byCustomer.map((c) => [c.party.name, c.revenue])).toEqual([
    ["Small Co", 20_000_00n],
  ])
  expect(r2.nextCursor).toBeNull()
  expect(r1.withoutCustomer).toBe(3_000_00n)
  expect(r1.byStream).toEqual([
    expect.objectContaining({ code: "4100", revenue: 78_000_00n }),
  ])

  // Cash: the manual sale is in the bank; one unknown statement line waits.
  const conn = await connect(ctx, "bank-statement", {
    label: "HDFC",
    ledgerAccountId: id("1110"),
  })
  const d = today.split("-").reverse().join("/")
  await importFile(
    ctx,
    "bank-statement",
    {
      kind: "text",
      fileName: "hdfc.csv",
      mimeType: "text/csv",
      text: [
        "Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance",
        `${d},UNKNOWN SHOP ${Date.now()},1,250.00,,2750.00`,
      ].join("\n"),
    },
    { connectionId: conn.id }
  )
  const cash = await getCashPosition(ctx, today)
  console.log("cash", cash)
  const bank = cash.accounts.find((a) => a.code === "1110")
  expect(bank).toMatchObject({
    kind: "bank",
    balance: 3_000_00n,
    lastStatementDate: today,
    unmatched: { count: 1, amount: -250_00n },
    matched: { count: 0, amount: 0n },
  })
  expect(cash.accounts.find((a) => a.code === "1120")?.kind).toBe("razorpay")
  expect(cash.accounts.find((a) => a.code === "1100")?.kind).toBe("cash")
  expect(cash.total).toBe(3_000_00n)
})
