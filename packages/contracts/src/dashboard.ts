import type { Money } from "@workspace/ledger"

import type { IsoTimestamp, Period } from "./common"

export interface DashboardSummary {
  readonly asOf: IsoTimestamp
  /** Cash and cash equivalents (cash, bank and Razorpay clearing balances). */
  readonly cash: Money
  readonly revenueThisMonth: Money
  readonly revenueLastMonth: Money
  /** Computed on the server; the UI only formats it. */
  readonly revenueChange: {
    /** This month minus last month. Negative is a fall. */
    readonly amount: Money
    /**
     * Change in basis points of last month (+12.93% = 1293), rounded half
     * away from zero. Null when last month's revenue was zero.
     */
    readonly percentBps: number | null
  }
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
