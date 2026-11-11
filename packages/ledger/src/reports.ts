import type { Money } from "./money"
import { paise } from "./money"
import type { AccountType } from "./types"

/**
 * Financial statements from per-account totals. The database sums the
 * lines; everything here is pure, so the grouping and the balancing are
 * unit-tested. Groups follow Schedule III (Companies Act 2013, Division I)
 * using the code ranges in chart-of-accounts.ts; an account whose code is
 * outside its type's ranges falls back to the type's "other" line item.
 */

export type StatementSection =
  | "shareholders_funds"
  | "non_current_liabilities"
  | "current_liabilities"
  | "non_current_assets"
  | "current_assets"
  | "revenue_from_operations"
  | "other_income"
  | "cost_of_materials_and_services"
  | "employee_benefits"
  | "finance_costs"
  | "depreciation_and_amortisation"
  | "other_expenses"

export type LineItem =
  | "share_capital"
  | "reserves_and_surplus"
  | "long_term_borrowings"
  | "other_long_term_liabilities"
  | "trade_payables"
  | "other_current_liabilities"
  | "short_term_provisions"
  | "property_plant_and_equipment"
  | "intangible_assets"
  | "other_non_current_assets"
  | "inventories"
  | "trade_receivables"
  | "cash_and_cash_equivalents"
  | "short_term_loans_and_advances"
  | "other_current_assets"
  | StatementSection

export const SECTION_LABELS: Readonly<Record<StatementSection, string>> = {
  shareholders_funds: "Shareholders' funds",
  non_current_liabilities: "Non-current liabilities",
  current_liabilities: "Current liabilities",
  non_current_assets: "Non-current assets",
  current_assets: "Current assets",
  revenue_from_operations: "Revenue from operations",
  other_income: "Other income",
  cost_of_materials_and_services: "Cost of materials and services",
  employee_benefits: "Employee benefits expense",
  finance_costs: "Finance costs",
  depreciation_and_amortisation: "Depreciation and amortisation expense",
  other_expenses: "Other expenses",
}

export const LINE_ITEM_LABELS: Readonly<Record<LineItem, string>> = {
  ...SECTION_LABELS,
  share_capital: "Share capital",
  reserves_and_surplus: "Reserves and surplus",
  long_term_borrowings: "Long-term borrowings",
  other_long_term_liabilities: "Other long-term liabilities",
  trade_payables: "Trade payables",
  other_current_liabilities: "Other current liabilities",
  short_term_provisions: "Short-term provisions",
  property_plant_and_equipment: "Property, plant and equipment",
  intangible_assets: "Intangible assets",
  other_non_current_assets: "Other non-current assets",
  inventories: "Inventories",
  trade_receivables: "Trade receivables",
  cash_and_cash_equivalents: "Cash and cash equivalents",
  short_term_loans_and_advances: "Short-term loans and advances",
  other_current_assets: "Other current assets",
}

/** Schedule III order of the sections on each statement. */
export const BALANCE_SHEET_SECTIONS = {
  equityAndLiabilities: [
    "shareholders_funds",
    "non_current_liabilities",
    "current_liabilities",
  ],
  assets: ["non_current_assets", "current_assets"],
} as const satisfies Record<string, readonly StatementSection[]>

export const PROFIT_AND_LOSS_SECTIONS = {
  income: ["revenue_from_operations", "other_income"],
  expenses: [
    "cost_of_materials_and_services",
    "employee_benefits",
    "finance_costs",
    "depreciation_and_amortisation",
    "other_expenses",
  ],
} as const satisfies Record<string, readonly StatementSection[]>

export interface Classification {
  readonly section: StatementSection
  readonly lineItem: LineItem
}

type Range = readonly [from: number, to: number, Classification]

const c = (section: StatementSection, lineItem: LineItem = section) => ({
  section,
  lineItem,
})

const RANGES: Readonly<Record<AccountType, readonly Range[]>> = {
  asset: [
    [1100, 1199, c("current_assets", "cash_and_cash_equivalents")],
    [1200, 1299, c("current_assets", "trade_receivables")],
    [1300, 1399, c("current_assets", "short_term_loans_and_advances")],
    [1400, 1499, c("current_assets", "other_current_assets")],
    [1500, 1599, c("current_assets", "inventories")],
    [1600, 1699, c("non_current_assets", "property_plant_and_equipment")],
    [1700, 1799, c("non_current_assets", "intangible_assets")],
    [1800, 1999, c("non_current_assets", "other_non_current_assets")],
  ],
  liability: [
    [2100, 2199, c("current_liabilities", "trade_payables")],
    [2200, 2399, c("current_liabilities", "other_current_liabilities")],
    [2400, 2499, c("current_liabilities", "short_term_provisions")],
    [2500, 2599, c("non_current_liabilities", "long_term_borrowings")],
    [2600, 2999, c("non_current_liabilities", "other_long_term_liabilities")],
  ],
  equity: [
    [3000, 3199, c("shareholders_funds", "share_capital")],
    [3200, 3999, c("shareholders_funds", "reserves_and_surplus")],
  ],
  income: [
    [4000, 4499, c("revenue_from_operations")],
    [4500, 4999, c("other_income")],
  ],
  expense: [
    [5000, 5099, c("cost_of_materials_and_services")],
    [5100, 5199, c("employee_benefits")],
    [5200, 5799, c("other_expenses")],
    [5800, 5899, c("finance_costs")],
    [5900, 5999, c("depreciation_and_amortisation")],
  ],
}

const FALLBACK: Readonly<Record<AccountType, Classification>> = {
  asset: c("current_assets", "other_current_assets"),
  liability: c("current_liabilities", "other_current_liabilities"),
  equity: c("shareholders_funds", "reserves_and_surplus"),
  income: c("other_income"),
  expense: c("other_expenses"),
}

/** Where an account appears on the balance sheet or P&L. */
export function classifyAccount(
  code: string,
  type: AccountType
): Classification {
  const n = /^\d{4}$/.test(code) ? Number(code) : Number.NaN
  const hit = RANGES[type].find(([from, to]) => n >= from && n <= to)
  return hit ? hit[2] : FALLBACK[type]
}

/** Assets and expenses are debit-natured; the rest are credit-natured. */
export function isDebitNatured(type: AccountType): boolean {
  return type === "asset" || type === "expense"
}

/** One account's metadata and the sum of its lines over the report range. */
export interface AccountTotals {
  readonly accountId: string
  readonly code: string
  readonly name: string
  readonly type: AccountType
  readonly debit: Money
  readonly credit: Money
}

/** Balance in the account's natural direction (negative if it's flipped). */
export function naturalBalance(a: AccountTotals): Money {
  return paise(isDebitNatured(a.type) ? a.debit - a.credit : a.credit - a.debit)
}

const byCode = (x: { code: string }, y: { code: string }) =>
  x.code < y.code ? -1 : x.code > y.code ? 1 : 0

const sum = (values: readonly bigint[]): Money =>
  paise(values.reduce((s, v) => s + v, 0n))

export interface TrialBalanceRow {
  readonly accountId: string
  readonly code: string
  readonly name: string
  readonly type: AccountType
  readonly debit: Money
  readonly credit: Money
}

/** Closing balances on one side each; the totals are equal for a balanced ledger. */
export function buildTrialBalance(totals: readonly AccountTotals[]): {
  rows: TrialBalanceRow[]
  totalDebit: Money
  totalCredit: Money
} {
  const rows = [...totals].sort(byCode).map((a) => {
    const net = a.debit - a.credit
    return {
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      type: a.type,
      debit: paise(net > 0n ? net : 0n),
      credit: paise(net < 0n ? -net : 0n),
    }
  })
  return {
    rows,
    totalDebit: sum(rows.map((r) => r.debit)),
    totalCredit: sum(rows.map((r) => r.credit)),
  }
}

export interface StatementRow {
  readonly accountId: string
  readonly code: string
  readonly name: string
  readonly lineItem: LineItem
  readonly amount: Money
}

export interface StatementSectionResult {
  readonly key: StatementSection
  readonly label: string
  readonly rows: readonly StatementRow[]
  readonly total: Money
}

function sectionsOf(
  keys: readonly StatementSection[],
  rows: readonly (StatementRow & { section: StatementSection })[]
): StatementSectionResult[] {
  return keys.map((key) => {
    const own = rows
      .filter((r) => r.section === key)
      .map(({ section: _section, ...r }) => r)
    return {
      key,
      label: SECTION_LABELS[key],
      rows: own,
      total: sum(own.map((r) => r.amount)),
    }
  })
}

function statementRows(totals: readonly AccountTotals[]) {
  return [...totals]
    .sort(byCode)
    .map((a) => ({ a, amount: naturalBalance(a) }))
    .filter(({ amount }) => amount !== 0n)
    .map(({ a, amount }) => {
      const cls = classifyAccount(a.code, a.type)
      return {
        accountId: a.accountId,
        code: a.code,
        name: a.name,
        section: cls.section,
        lineItem: cls.lineItem,
        amount,
      }
    })
}

/** Income minus expenses over the accounts given (any other types ignored). */
export function profitOf(totals: readonly AccountTotals[]): Money {
  return sum(
    totals.map((a) =>
      a.type === "income"
        ? a.credit - a.debit
        : a.type === "expense"
          ? -(a.debit - a.credit)
          : 0n
    )
  )
}

/** P&L from income and expense totals over the period. */
export function buildProfitAndLoss(totals: readonly AccountTotals[]) {
  const rows = statementRows(
    totals.filter((a) => a.type === "income" || a.type === "expense")
  )
  const income = sectionsOf(PROFIT_AND_LOSS_SECTIONS.income, rows)
  const expenses = sectionsOf(PROFIT_AND_LOSS_SECTIONS.expenses, rows)
  const totalIncome = sum(income.map((s) => s.total))
  const totalExpenses = sum(expenses.map((s) => s.total))
  return {
    income,
    expenses,
    totalIncome,
    totalExpenses,
    netProfit: paise(totalIncome - totalExpenses),
  }
}

/** Synthetic row ids for profit not yet closed to reserves. */
export const CURRENT_YEAR_PROFIT_ID = "current-year-profit"
export const PREVIOUS_YEARS_SURPLUS_ID = "previous-years-surplus"

/**
 * Balance sheet from cumulative totals up to the as-of date. Income and
 * expense balances are never closed by an entry, so the profit is split at
 * the financial year start: `currentYear` totals (FY start → as of) give
 * the current-year surplus, everything before it the previous years'. Both
 * go into reserves and surplus, so a balanced ledger balances here.
 */
export function buildBalanceSheet(
  cumulative: readonly AccountTotals[],
  currentYear: readonly AccountTotals[]
) {
  const currentYearProfit = profitOf(currentYear)
  const previousYearsSurplus = paise(profitOf(cumulative) - currentYearProfit)
  const surplus = (id: string, name: string, amount: Money) => ({
    accountId: id,
    code: "",
    name,
    section: "shareholders_funds" as const,
    lineItem: "reserves_and_surplus" as const,
    amount,
  })
  const rows = [
    ...statementRows(
      cumulative.filter(
        (a) =>
          a.type === "asset" || a.type === "liability" || a.type === "equity"
      )
    ),
    ...(previousYearsSurplus === 0n
      ? []
      : [
          surplus(
            PREVIOUS_YEARS_SURPLUS_ID,
            "Surplus (previous years)",
            previousYearsSurplus
          ),
        ]),
    ...(currentYearProfit === 0n
      ? []
      : [
          surplus(
            CURRENT_YEAR_PROFIT_ID,
            "Surplus (current year)",
            currentYearProfit
          ),
        ]),
  ]
  const equityAndLiabilities = sectionsOf(
    BALANCE_SHEET_SECTIONS.equityAndLiabilities,
    rows
  )
  const assets = sectionsOf(BALANCE_SHEET_SECTIONS.assets, rows)
  return {
    equityAndLiabilities,
    assets,
    totalEquityAndLiabilities: sum(equityAndLiabilities.map((s) => s.total)),
    totalAssets: sum(assets.map((s) => s.total)),
    currentYearProfit,
  }
}

/** First day of the financial year (April–March) containing a date. */
/**
 * The same calendar day a year earlier, for comparative figures
 * (29 Feb → 28 Feb).
 */
export function sameDayLastYear(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4)) - 1
  const monthDay = isoDate.slice(5)
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  return `${year}-${monthDay === "02-29" && !leap ? "02-28" : monthDay}`
}

/** The day before an ISO date (opening balances for a period). */
export function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function financialYearStart(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4))
  const month = Number(isoDate.slice(5, 7))
  return `${month >= 4 ? year : year - 1}-04-01`
}
