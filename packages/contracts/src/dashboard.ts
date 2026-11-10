import type { Money } from "@workspace/ledger"

import type { IsoTimestamp, Period } from "./common"

export interface DashboardSummary {
  readonly asOf: IsoTimestamp
  /** Cash in bank and in hand. Razorpay clearing is in `heldByRazorpay`. */
  readonly cash: Money
  /**
   * Razorpay clearing balance: collected by Razorpay, not yet settled to the
   * bank. Kept out of `cash`, so fees booked before a settlement can't make
   * cash in bank look negative.
   */
  readonly heldByRazorpay: Money
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
