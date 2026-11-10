import { describe, expect, it } from "vitest"

import { paise } from "@workspace/ledger"

import { dashboardMonths, splitCash } from "./dashboard"
import type { AccountTotalsRow } from "./reports"

const asset = (
  code: string,
  debit: bigint,
  credit: bigint,
  extra: Partial<AccountTotalsRow> = {}
): AccountTotalsRow => ({
  accountId: `acc_${code}`,
  code,
  name: code,
  type: "asset",
  systemKey: null,
  isBank: false,
  debit: paise(debit),
  credit: paise(credit),
  ...extra,
})

describe("dashboardMonths", () => {
  it("covers this month so far and all of last month", () => {
    expect(dashboardMonths("2026-11-10")).toEqual({
      period: "2026-11",
      thisMonth: { from: "2026-11-01", to: "2026-11-10" },
      lastMonth: { from: "2026-10-01", to: "2026-10-31" },
    })
  })

  it("handles January and leap years", () => {
    expect(dashboardMonths("2027-01-05").lastMonth).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    })
    expect(dashboardMonths("2028-03-01").lastMonth.to).toBe("2028-02-29")
  })
})

describe("splitCash", () => {
  it("keeps Razorpay clearing out of cash in bank", () => {
    const rows = [
      asset("1100", 5_000_00n, 0n),
      asset("1110", 2_00_000_00n, 50_000_00n, { isBank: true }),
      asset("1120", 30_000_00n, 10_000_00n, {
        systemKey: "razorpay_clearing",
      }),
    ]
    expect(splitCash(rows)).toEqual({
      cash: 1_55_000_00n,
      heldByRazorpay: 20_000_00n,
    })
  })

  it("can't go negative from Razorpay fees alone", () => {
    // Fees booked against clearing before any settlement reaches the bank.
    const rows = [
      asset("1110", 0n, 0n, { isBank: true }),
      asset("1120", 0n, 1_180_00n, { systemKey: "razorpay_clearing" }),
    ]
    expect(splitCash(rows)).toEqual({ cash: 0n, heldByRazorpay: -1_180_00n })
  })
})
