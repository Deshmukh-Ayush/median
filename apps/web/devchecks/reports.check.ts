import { and, eq } from "drizzle-orm"
import { expect, it } from "vitest"
import { paise } from "@workspace/ledger"
import { getDb } from "../src/server/db"
import { ledgerAccounts } from "../src/server/db/schema"
import { getDashboardSummary } from "../src/server/services/dashboard"
import { postManualEntry, reverseEntry } from "../src/server/services/ledger"
import { istDateOf } from "../src/server/services/posting-rules"
import {
  getBalanceSheet,
  getProfitAndLoss,
  getTrialBalance,
  listEntries,
} from "../src/server/services/reports"
import { freshDevOrg } from "./setup"

it("trial balance, P&L, balance sheet, drill-down and dashboard", async () => {
  const ctx = await freshDevOrg("reports")
  const db = getDb()
  const accounts = await db
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.organizationId, ctx.orgId)))
  const id = (code: string) => accounts.find((a) => a.code === code)!.id
  const dr = (code: string, rupees: bigint) => ({
    accountId: id(code),
    debit: paise(rupees * 100n),
    credit: paise(0n),
  })
  const cr = (code: string, rupees: bigint) => ({
    accountId: id(code),
    debit: paise(0n),
    credit: paise(rupees * 100n),
  })
  const today = istDateOf(new Date())

  // Last financial year: capital and one sale. This year: salary and a sale.
  await postManualEntry(ctx, {
    entryDate: "2025-06-01",
    narration: "Share capital",
    lines: [dr("1110", 10_00_000n), cr("3100", 10_00_000n)],
  })
  await postManualEntry(ctx, {
    entryDate: "2025-09-01",
    narration: "Sale, last year",
    lines: [dr("1200", 1_18_000n), cr("4100", 1_00_000n), cr("2212", 18_000n)],
  })
  await postManualEntry(ctx, {
    entryDate: "2026-05-10",
    narration: "Salaries May",
    lines: [dr("5100", 40_000n), cr("1110", 40_000n)],
  })
  await postManualEntry(ctx, {
    entryDate: today,
    narration: "Sale, this month",
    lines: [
      dr("1110", 59_000n),
      cr("4100", 50_000n),
      cr("2210", 4_500n),
      cr("2211", 4_500n),
    ],
  })
  const wrong = await postManualEntry(ctx, {
    entryDate: today,
    narration: "Posted to the wrong account",
    lines: [dr("5200", 1_000n), cr("1110", 1_000n)],
  })
  await reverseEntry(ctx, wrong.id, { date: today })

  const tb = await getTrialBalance(ctx, today)
  expect(tb.totalDebit).toBe(tb.totalCredit)
  expect(tb.rows.find((r) => r.code === "1110")?.debit).toBe(10_19_000_00n)
  expect(tb.rows.find((r) => r.code === "5200")).toMatchObject({
    debit: 0n,
    credit: 0n,
  })

  const pl = await getProfitAndLoss(ctx, "2026-04-01", today)
  expect(pl.totalIncome).toBe(50_000_00n)
  expect(pl.expenses.find((s) => s.key === "employee_benefits")?.total).toBe(
    40_000_00n
  )
  expect(pl.netProfit).toBe(10_000_00n)

  const bs = await getBalanceSheet(ctx, today)
  expect(bs.totalAssets).toBe(bs.totalEquityAndLiabilities)
  expect(bs.totalAssets).toBe(11_37_000_00n)
  expect(bs.currentYearProfit).toBe(10_000_00n)
  const funds = bs.equityAndLiabilities.find(
    (s) => s.key === "shareholders_funds"
  )
  expect(funds?.rows.map((r) => [r.name, r.amount])).toEqual([
    ["Share capital", 10_00_000_00n],
    ["Surplus (previous years)", 1_00_000_00n],
    ["Surplus (current year)", 10_000_00n],
  ])

  // Drill-down: the bank account has 5 entries; page through them by 2.
  const seen: string[] = []
  let cursor: string | null = null
  do {
    const page = await listEntries(ctx, { accountId: id("1110") }, cursor, {
      limit: 2,
    })
    expect(page.items.length).toBeLessThanOrEqual(2)
    seen.push(...page.items.map((e) => e.narration))
    for (const e of page.items) {
      expect(e.lines.some((l) => l.account.id === id("1110"))).toBe(true)
      expect(e.total).toBe(e.lines.reduce((s, l) => s + l.credit, 0n))
    }
    cursor = page.nextCursor
  } while (cursor)
  expect(seen).toHaveLength(5)
  expect(seen.at(-1)).toBe("Share capital")

  const all = await listEntries(ctx, {}, null, { limit: 50 })
  expect(all.items).toHaveLength(6)
  const original = all.items.find((e) => e.id === wrong.id)
  expect(original?.reversedByEntryId).not.toBeNull()
  expect(
    (await listEntries(ctx, { search: "salaries" }, null)).items.map(
      (e) => e.narration
    )
  ).toEqual(["Salaries May"])
  expect(
    (await listEntries(ctx, { sourceType: "reversal" }, null)).items
  ).toHaveLength(1)

  const dash = await getDashboardSummary(ctx)
  expect(dash.cash).toBe(10_19_000_00n)
  expect(dash.revenueThisMonth).toBe(50_000_00n)
  expect(dash.gstPayable.amount).toBe(9_000_00n)
  expect(dash.inboxPendingCount).toBe(0)
})
