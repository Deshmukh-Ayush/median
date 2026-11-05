import "server-only"

import { paise } from "@workspace/ledger"

import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { currentPeriod } from "./stub-data"
import type { IsoTimestamp, Money, Period } from "./types"

export interface DashboardSummary {
  readonly asOf: IsoTimestamp
  /** Bank + Razorpay clearing balances. */
  readonly cash: Money
  readonly revenueThisMonth: Money
  readonly revenueLastMonth: Money
  readonly receivables: {
    /** Unpaid invoice balances. */
    readonly outstanding: Money
    /** Part of `outstanding` past its due date. */
    readonly overdue: Money
    readonly invoiceCount: number
  }
  readonly gstPayable: {
    readonly period: Period
    /** Output tax minus input tax credit. Negative means ITC carried forward. */
    readonly amount: Money
  }
  readonly inboxPendingCount: number
}

/** Headline numbers for the home screen. STUB. */
export async function getDashboardSummary(
  ctx: OrgContext
): Promise<DashboardSummary> {
  assertCan(ctx, "report", "read")
  await Promise.resolve()
  return {
    asOf: new Date().toISOString(),
    cash: paise(25_44_250_00n),
    revenueThisMonth: paise(3_10_000_00n),
    revenueLastMonth: paise(2_74_500_00n),
    receivables: {
      outstanding: paise(3_42_200_00n),
      overdue: paise(53_100_00n),
      invoiceCount: 4,
    },
    gstPayable: { period: currentPeriod(), amount: paise(1_48_993_80n) },
    inboxPendingCount: 3,
  }
}
