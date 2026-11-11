// Cash flow statement, indirect method (AS 3 / Ind AS 7), from account
// balances at the start and end of a period and the period's P&L totals.
//
// Every balance-sheet account other than cash falls in exactly one section,
// so operating + investing + financing always equals the change in cash; the
// builder reports any difference, which is zero for a balanced ledger.

import type { Money } from "./money"
import { paise } from "./money"
import {
  LINE_ITEM_LABELS,
  classifyAccount,
  naturalBalance,
  profitOf,
} from "./reports"
import type { AccountTotals, LineItem } from "./reports"

export interface CashFlowAccount extends AccountTotals {
  /** e.g. "razorpay_clearing", which is held by the gateway, not cash. */
  readonly systemKey: string | null
}

export interface CashFlowLine {
  readonly key: string
  readonly label: string
  /** Positive: cash came in. Negative: cash went out. */
  readonly amount: Money
}

export interface CashFlowSection {
  readonly lines: readonly CashFlowLine[]
  readonly total: Money
}

export interface CashFlowResult {
  readonly netProfit: Money
  readonly operating: CashFlowSection
  readonly investing: CashFlowSection
  readonly financing: CashFlowSection
  readonly netChange: Money
  readonly openingCash: Money
  readonly closingCash: Money
  /** Net change minus the actual change in cash. Zero when balanced. */
  readonly difference: Money
}

/** Gateway money awaiting settlement isn't cash in the bank (see #93). */
const NOT_CASH = new Set(["razorpay_clearing"])

const isCash = (a: CashFlowAccount, lineItem: LineItem) =>
  lineItem === "cash_and_cash_equivalents" &&
  !(a.systemKey && NOT_CASH.has(a.systemKey))

const WORKING_CAPITAL: readonly LineItem[] = [
  "trade_receivables",
  "short_term_loans_and_advances",
  "other_current_assets",
  "inventories",
  "trade_payables",
  "other_current_liabilities",
  "short_term_provisions",
]

const sum = (values: readonly bigint[]): Money =>
  paise(values.reduce((s, v) => s + v, 0n))

function section(lines: CashFlowLine[]): CashFlowSection {
  const kept = lines.filter((l) => l.amount !== 0n)
  return { lines: kept, total: sum(kept.map((l) => l.amount)) }
}

/**
 * `opening`: cumulative totals up to the day before the period; `closing`:
 * up to its last day; `period`: income and expense totals within it.
 */
export function buildCashFlow(input: {
  readonly opening: readonly CashFlowAccount[]
  readonly closing: readonly CashFlowAccount[]
  readonly period: readonly AccountTotals[]
}): CashFlowResult {
  const netProfit = profitOf(input.period)
  const periodBy = (s: string) =>
    sum(
      input.period
        .filter((a) => classifyAccount(a.code, a.type).section === s)
        .map((a) => naturalBalance(a))
    )
  const depreciation = periodBy("depreciation_and_amortisation")
  const financeCosts = periodBy("finance_costs")

  // Change in each balance-sheet account's natural balance over the period.
  const accounts = new Map<string, CashFlowAccount>()
  for (const a of [...input.opening, ...input.closing])
    if (a.type === "asset" || a.type === "liability" || a.type === "equity")
      accounts.set(a.accountId, a)
  const balanceIn = (list: readonly CashFlowAccount[], id: string): bigint => {
    const a = list.find((x) => x.accountId === id)
    return a ? naturalBalance(a) : 0n
  }

  let openingCash = 0n
  let closingCash = 0n
  // Cash effect by line item: an asset going up uses cash, a liability or
  // equity going up brings it in.
  const effect = new Map<string, bigint>()
  const add = (key: string, v: bigint) =>
    effect.set(key, (effect.get(key) ?? 0n) + v)
  for (const a of accounts.values()) {
    const { lineItem, section: s } = classifyAccount(a.code, a.type)
    const open = balanceIn(input.opening, a.accountId)
    const close = balanceIn(input.closing, a.accountId)
    if (isCash(a, lineItem)) {
      openingCash += open
      closingCash += close
      continue
    }
    const delta = close - open
    const cash = a.type === "asset" ? -delta : delta
    if (lineItem === "cash_and_cash_equivalents") add("gateway", cash)
    else if (s === "non_current_assets")
      add(lineItem === "other_non_current_assets" ? lineItem : "fixed", cash)
    else if (s === "shareholders_funds") add("equity", cash)
    else add(lineItem, cash)
  }
  const get = (key: string) => paise(effect.get(key) ?? 0n)

  const operating = section([
    {
      key: "depreciation",
      label: "Add: depreciation and amortisation",
      amount: depreciation,
    },
    { key: "finance_costs", label: "Add: finance costs", amount: financeCosts },
    ...WORKING_CAPITAL.map((li) => ({
      key: li,
      label: `Change in ${LINE_ITEM_LABELS[li].toLowerCase()}`,
      amount: get(li),
    })),
    {
      key: "gateway",
      label: "Change in money held by payment gateways",
      amount: get("gateway"),
    },
  ])
  const investing = section([
    {
      key: "fixed",
      label: "Purchase of property, plant and intangibles (net of disposals)",
      // Carrying amount fell by depreciation, which isn't a cash outflow.
      amount: paise(get("fixed") - depreciation),
    },
    {
      key: "other_non_current_assets",
      label: "Change in other non-current assets",
      amount: get("other_non_current_assets"),
    },
  ])
  const financing = section([
    {
      key: "equity",
      label: "Share capital and other equity",
      amount: get("equity"),
    },
    {
      key: "long_term_borrowings",
      label: "Change in long-term borrowings",
      amount: get("long_term_borrowings"),
    },
    {
      key: "other_long_term_liabilities",
      label: "Change in other long-term liabilities",
      amount: get("other_long_term_liabilities"),
    },
    {
      key: "interest_paid",
      label: "Interest paid",
      amount: paise(0n - financeCosts),
    },
  ])
  const operatingTotal = paise(netProfit + operating.total)
  const netChange = paise(operatingTotal + investing.total + financing.total)
  return {
    netProfit,
    operating: { lines: operating.lines, total: operatingTotal },
    investing,
    financing,
    netChange,
    openingCash: paise(openingCash),
    closingCash: paise(closingCash),
    difference: paise(netChange - (closingCash - openingCash)),
  }
}
