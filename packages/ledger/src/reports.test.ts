import { describe, expect, it } from "vitest"

import {
  BASE_ACCOUNTS,
  INDUSTRIES,
  chartOfAccountsFor,
} from "./chart-of-accounts"
import { paise } from "./money"
import type { AccountTotals } from "./reports"
import {
  CURRENT_YEAR_PROFIT_ID,
  PREVIOUS_YEARS_SURPLUS_ID,
  buildBalanceSheet,
  buildProfitAndLoss,
  buildTrialBalance,
  classifyAccount,
  dayBefore,
  financialYearStart,
  sameDayLastYear,
} from "./reports"
import type { AccountType } from "./types"

const t = (
  code: string,
  type: AccountType,
  debit: bigint,
  credit: bigint
): AccountTotals => ({
  accountId: `acc-${code}`,
  code,
  name: `Account ${code}`,
  type,
  debit: paise(debit),
  credit: paise(credit),
})

describe("classifyAccount (Schedule III)", () => {
  it("groups template accounts by code range", () => {
    expect(classifyAccount("1110", "asset")).toEqual({
      section: "current_assets",
      lineItem: "cash_and_cash_equivalents",
    })
    expect(classifyAccount("1200", "asset").lineItem).toBe("trade_receivables")
    expect(classifyAccount("1412", "asset").lineItem).toBe(
      "other_current_assets"
    )
    expect(classifyAccount("1690", "asset").section).toBe("non_current_assets")
    expect(classifyAccount("2212", "liability").lineItem).toBe(
      "other_current_liabilities"
    )
    expect(classifyAccount("2500", "liability").section).toBe(
      "non_current_liabilities"
    )
    expect(classifyAccount("3100", "equity").lineItem).toBe("share_capital")
    expect(classifyAccount("3900", "equity").lineItem).toBe(
      "reserves_and_surplus"
    )
    expect(classifyAccount("4100", "income").section).toBe(
      "revenue_from_operations"
    )
    expect(classifyAccount("4900", "income").section).toBe("other_income")
    expect(classifyAccount("5100", "expense").section).toBe("employee_benefits")
    expect(classifyAccount("5310", "expense").section).toBe("other_expenses")
    expect(classifyAccount("5800", "expense").section).toBe("finance_costs")
    expect(classifyAccount("5900", "expense").section).toBe(
      "depreciation_and_amortisation"
    )
  })

  it("falls back by type when the code is outside the type's ranges", () => {
    expect(classifyAccount("9001", "asset").lineItem).toBe(
      "other_current_assets"
    )
    expect(classifyAccount("ABC", "income").section).toBe("other_income")
    expect(classifyAccount("1100", "expense").section).toBe("other_expenses")
  })

  it("keeps every template code inside the documented ranges", () => {
    for (const industry of INDUSTRIES) {
      for (const a of [...BASE_ACCOUNTS, ...chartOfAccountsFor(industry)]) {
        const n = Number(a.code)
        // Each template code lies in one of the documented ranges.
        expect(n, a.code).toBeGreaterThanOrEqual(1000)
        expect(n, a.code).toBeLessThanOrEqual(5999)
        expect(classifyAccount(a.code, a.type)).toBeDefined()
      }
    }
  })
})

describe("buildTrialBalance", () => {
  it("puts each closing balance on one side and totals them", () => {
    const tb = buildTrialBalance([
      t("4100", "income", 0n, 1000_00n),
      t("1110", "asset", 1500_00n, 300_00n),
      t("2100", "liability", 100_00n, 300_00n),
    ])
    expect(tb.rows.map((r) => r.code)).toEqual(["1110", "2100", "4100"])
    expect(tb.rows[0]).toMatchObject({ debit: 1200_00n, credit: 0n })
    expect(tb.rows[1]).toMatchObject({ debit: 0n, credit: 200_00n })
    expect(tb.totalDebit).toBe(1200_00n)
    expect(tb.totalCredit).toBe(1200_00n)
  })
})

describe("buildProfitAndLoss", () => {
  it("groups income and expenses in Schedule III order", () => {
    const pl = buildProfitAndLoss([
      t("4100", "income", 0n, 10_000_00n),
      t("4900", "income", 0n, 50_00n),
      t("5100", "expense", 4_000_00n, 0n),
      t("5310", "expense", 236_00n, 0n),
      t("5790", "expense", 0n, 1n), // round-off credit: negative expense
      t("1110", "asset", 99_00n, 0n), // ignored
    ])
    expect(pl.income.map((s) => s.key)).toEqual([
      "revenue_from_operations",
      "other_income",
    ])
    expect(pl.expenses.map((s) => s.key)).toEqual([
      "cost_of_materials_and_services",
      "employee_benefits",
      "finance_costs",
      "depreciation_and_amortisation",
      "other_expenses",
    ])
    expect(pl.totalIncome).toBe(10_050_00n)
    expect(pl.expenses.at(-1)?.total).toBe(235_99n)
    expect(pl.totalExpenses).toBe(4_235_99n)
    expect(pl.netProfit).toBe(5_814_01n)
  })

  it("reports a loss as negative net profit", () => {
    const pl = buildProfitAndLoss([t("5200", "expense", 100n, 0n)])
    expect(pl.netProfit).toBe(-100n)
  })
})

describe("buildBalanceSheet", () => {
  // A balanced ledger: capital 10L, last year's profit 1L, this year's 50k.
  const cumulative = [
    t("3100", "equity", 0n, 10_00_000_00n),
    t("1110", "asset", 11_70_000_00n, 0n),
    t("1200", "asset", 40_000_00n, 0n),
    t("1690", "asset", 0n, 10_000_00n), // accumulated depreciation
    t("1600", "asset", 60_000_00n, 0n),
    t("2100", "liability", 0n, 1_10_000_00n),
    t("4100", "income", 0n, 3_00_000_00n),
    t("5100", "expense", 1_50_000_00n, 0n),
  ]
  const currentYear = [
    t("4100", "income", 0n, 1_00_000_00n),
    t("5100", "expense", 50_000_00n, 0n),
  ]

  it("balances, with profit split into previous and current years", () => {
    const bs = buildBalanceSheet(cumulative, currentYear)
    expect(bs.totalAssets).toBe(12_60_000_00n)
    expect(bs.totalEquityAndLiabilities).toBe(bs.totalAssets)
    expect(bs.currentYearProfit).toBe(50_000_00n)
    const funds = bs.equityAndLiabilities[0]
    expect(funds?.key).toBe("shareholders_funds")
    expect(funds?.rows.map((r) => [r.accountId, r.amount])).toEqual([
      ["acc-3100", 10_00_000_00n],
      [PREVIOUS_YEARS_SURPLUS_ID, 1_00_000_00n],
      [CURRENT_YEAR_PROFIT_ID, 50_000_00n],
    ])
  })

  it("nets contra accounts within their line item and drops zero rows", () => {
    const bs = buildBalanceSheet(
      [...cumulative, t("1300", "asset", 5_00n, 5_00n)],
      currentYear
    )
    const nonCurrent = bs.assets[0]
    expect(nonCurrent?.rows.map((r) => [r.code, r.amount])).toEqual([
      ["1600", 60_000_00n],
      ["1690", -10_000_00n],
    ])
    expect(nonCurrent?.total).toBe(50_000_00n)
    expect(bs.assets[1]?.rows.some((r) => r.code === "1300")).toBe(false)
  })

  it("has no surplus rows when there is no profit", () => {
    const bs = buildBalanceSheet(
      [t("3100", "equity", 0n, 100n), t("1110", "asset", 100n, 0n)],
      []
    )
    expect(bs.equityAndLiabilities[0]?.rows).toHaveLength(1)
    expect(bs.totalAssets).toBe(bs.totalEquityAndLiabilities)
  })
})

describe("sameDayLastYear and dayBefore", () => {
  it("steps back a year, and a day", () => {
    expect(sameDayLastYear("2027-03-31")).toBe("2026-03-31")
    expect(sameDayLastYear("2028-02-29")).toBe("2027-02-28")
    expect(dayBefore("2026-04-01")).toBe("2026-03-31")
    expect(dayBefore("2026-01-01")).toBe("2025-12-31")
  })
})

describe("financialYearStart", () => {
  it("starts in April", () => {
    expect(financialYearStart("2026-11-10")).toBe("2026-04-01")
    expect(financialYearStart("2027-03-31")).toBe("2026-04-01")
    expect(financialYearStart("2026-04-01")).toBe("2026-04-01")
  })
})
