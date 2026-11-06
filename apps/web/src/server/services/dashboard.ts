import "server-only"

import type { DashboardSummary } from "@workspace/contracts"
import { paise, percentChangeBps } from "@workspace/ledger"

import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { currentPeriod } from "./stub-data"

/** Headline numbers for the home screen. STUB (Day 5 makes it real). */
export async function getDashboardSummary(
  ctx: OrgContext
): Promise<DashboardSummary> {
  assertCan(ctx, "report", "read")
  await Promise.resolve()
  const revenueThisMonth = paise(3_10_000_00n)
  const revenueLastMonth = paise(2_74_500_00n)
  return {
    asOf: new Date().toISOString(),
    cash: paise(25_44_250_00n),
    revenueThisMonth,
    revenueLastMonth,
    revenueChange: {
      amount: paise(revenueThisMonth - revenueLastMonth),
      percentBps: percentChangeBps(revenueThisMonth, revenueLastMonth),
    },
    receivables: {
      outstanding: paise(3_42_200_00n),
      overdue: paise(53_100_00n),
      invoiceCount: 4,
    },
    gstPayable: { period: currentPeriod(), amount: paise(1_48_993_80n) },
    inboxPendingCount: 3,
  }
}
