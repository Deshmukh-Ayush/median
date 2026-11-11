import { describe, expect, it } from "vitest"

import { buildCashFlow } from "./cash-flow"
import type { CashFlowAccount } from "./cash-flow"
import { paise } from "./money"
import type { AccountType } from "./types"

/** An account with a natural-side balance in rupees (debit for assets…). */
function acct(
  code: string,
  type: AccountType,
  rupees: number,
  systemKey: string | null = null
): CashFlowAccount {
  const v = paise(BigInt(Math.round(rupees * 100)))
  const debitSide = type === "asset" || type === "expense"
  const positive = v >= 0n
  const abs = paise(positive ? v : 0n - v)
  const zero = paise(0n)
  return {
    accountId: code,
    code,
    name: code,
    type,
    systemKey,
    debit: debitSide === positive ? abs : zero,
    credit: debitSide === positive ? zero : abs,
  }
}

const rupees = (n: number) => paise(BigInt(n * 100))

describe("buildCashFlow", () => {
  // Opening: ₹5,00,000 share capital in the bank. In the period: a
  // ₹1,18,000 invoice (₹59,000 received), ₹10,000 of sales held by Razorpay,
  // a ₹60,000 computer, ₹5,000 depreciation, a ₹2,00,000 loan and ₹2,000
  // interest.
  const opening = [
    acct("1110", "asset", 500_000),
    acct("3100", "equity", 500_000),
  ]
  const closing = [
    acct("1110", "asset", 697_000),
    acct("1120", "asset", 10_000, "razorpay_clearing"),
    acct("1200", "asset", 59_000),
    acct("1600", "asset", 60_000),
    acct("1690", "asset", -5_000),
    acct("2210", "liability", 18_000),
    acct("2500", "liability", 200_000),
    acct("3100", "equity", 500_000),
  ]
  const period = [
    acct("4100", "income", 110_000),
    acct("5900", "expense", 5_000),
    acct("5800", "expense", 2_000),
  ]
  const cf = buildCashFlow({ opening, closing, period })

  it("works from profit to cash, and ties to the bank", () => {
    expect(cf.netProfit).toBe(rupees(103_000))
    expect(cf.operating.total).toBe(rupees(59_000))
    expect(cf.investing.total).toBe(rupees(-60_000))
    expect(cf.financing.total).toBe(rupees(198_000))
    expect(cf.netChange).toBe(rupees(197_000))
    expect(cf.openingCash).toBe(rupees(500_000))
    expect(cf.closingCash).toBe(rupees(697_000))
    expect(cf.difference).toBe(0n)
  })

  it("shows each movement on its own line", () => {
    const line = (
      s: { lines: readonly { key: string; amount: bigint }[] },
      k: string
    ) => s.lines.find((l) => l.key === k)?.amount
    expect(line(cf.operating, "depreciation")).toBe(rupees(5_000))
    expect(line(cf.operating, "trade_receivables")).toBe(rupees(-59_000))
    expect(line(cf.operating, "other_current_liabilities")).toBe(rupees(18_000))
    // Gateway money isn't cash: it's a use of cash until settled.
    expect(line(cf.operating, "gateway")).toBe(rupees(-10_000))
    // The computer, not the computer net of depreciation.
    expect(line(cf.investing, "fixed")).toBe(rupees(-60_000))
    expect(line(cf.financing, "long_term_borrowings")).toBe(rupees(200_000))
    expect(line(cf.financing, "interest_paid")).toBe(rupees(-2_000))
    // Unchanged share capital and zero lines are left out.
    expect(line(cf.financing, "equity")).toBeUndefined()
  })
})
