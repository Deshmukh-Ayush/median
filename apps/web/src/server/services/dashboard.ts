import "server-only"

import type { DashboardSummary } from "@workspace/contracts"
import {
  classifyAccount,
  naturalBalance,
  paise,
  percentChangeBps,
} from "@workspace/ledger"
import { and, eq, inArray, sql } from "drizzle-orm"

import { getDb } from "../db"
import { inboxItems, invoices } from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { istDateOf } from "./posting-rules"
import { accountTotalsQuery, toAccountTotals } from "./reports"
import type { AccountTotalsRow } from "./reports"

const OUTPUT_TAX = ["gst_output_cgst", "gst_output_sgst", "gst_output_igst"]
const INPUT_TAX = ["gst_input_cgst", "gst_input_sgst", "gst_input_igst"]

const total = (
  rows: readonly AccountTotalsRow[],
  pick: (r: AccountTotalsRow) => boolean
) => paise(rows.filter(pick).reduce((s, r) => s + naturalBalance(r), 0n))

const isRazorpayClearing = (r: AccountTotalsRow) =>
  r.systemKey === "razorpay_clearing"

/** Bank and cash in hand. Razorpay clearing is reported on its own. */
const isCashInBank = (r: AccountTotalsRow) =>
  !isRazorpayClearing(r) &&
  (r.isBank ||
    classifyAccount(r.code, r.type).lineItem === "cash_and_cash_equivalents")

/** Cash in bank and the Razorpay clearing balance from asset totals. Pure. */
export function splitCash(assets: readonly AccountTotalsRow[]) {
  return {
    cash: total(assets, isCashInBank),
    heldByRazorpay: total(assets, isRazorpayClearing),
  }
}

const isRevenue = (r: AccountTotalsRow) =>
  r.type === "income" &&
  classifyAccount(r.code, r.type).section === "revenue_from_operations"

/** Calendar months around an IST date: this month so far and all of last month. */
export function dashboardMonths(today: string) {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`
  const last = month === 1 ? ym(year - 1, 12) : ym(year, month - 1)
  // Day 0 of this month is the last day of the previous one.
  const lastEnd = new Date(Date.UTC(year, month - 1, 0))
    .toISOString()
    .slice(0, 10)
  return {
    period: today.slice(0, 7),
    thisMonth: { from: `${today.slice(0, 7)}-01`, to: today },
    lastMonth: { from: `${last}-01`, to: lastEnd },
  }
}

/**
 * Headline numbers for the home screen, as of today (IST), in one batch:
 * cash in bank and held by Razorpay from ledger balances, revenue from operations for this month and
 * last, receivables from open invoices, GST payable from this month's tax
 * account movements, and the pending inbox count.
 */
export async function getDashboardSummary(
  ctx: OrgContext
): Promise<DashboardSummary> {
  assertCan(ctx, "report", "read")
  const now = new Date()
  const today = istDateOf(now)
  const months = dashboardMonths(today)
  const outstanding = sql`greatest(${invoices.totalPaise} - ${invoices.paidPaise} - ${invoices.creditedPaise}, 0)`
  const db = getDb()
  const [cumulative, thisMonth, lastMonth, receivables, inbox] = await db.batch(
    [
      accountTotalsQuery(ctx.orgId, { from: null, to: today }, ["asset"]),
      accountTotalsQuery(ctx.orgId, months.thisMonth),
      accountTotalsQuery(ctx.orgId, months.lastMonth, ["income"]),
      db
        .select({
          outstanding: sql<string>`coalesce(sum(${outstanding}), 0)::text`,
          overdue: sql<string>`coalesce(sum(${outstanding}) filter (where ${invoices.dueDate} < ${today}), 0)::text`,
          invoiceCount: sql<number>`count(*) filter (where ${outstanding} > 0)::int`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, ctx.orgId),
            inArray(invoices.status, ["issued", "partially_paid"])
          )
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.organizationId, ctx.orgId),
            eq(inboxItems.status, "pending")
          )
        ),
    ]
  )

  const assets = toAccountTotals(cumulative)
  const month = toAccountTotals(thisMonth)
  const revenueThisMonth = total(month, isRevenue)
  const revenueLastMonth = total(toAccountTotals(lastMonth), isRevenue)
  const output = total(month, (r) => OUTPUT_TAX.includes(r.systemKey ?? ""))
  const input = total(month, (r) => INPUT_TAX.includes(r.systemKey ?? ""))
  const r = receivables[0]
  return {
    asOf: now.toISOString(),
    ...splitCash(assets),
    revenueThisMonth,
    revenueLastMonth,
    revenueChange: {
      amount: paise(revenueThisMonth - revenueLastMonth),
      percentBps: percentChangeBps(revenueThisMonth, revenueLastMonth),
    },
    receivables: {
      outstanding: paise(BigInt(r?.outstanding ?? "0")),
      overdue: paise(BigInt(r?.overdue ?? "0")),
      invoiceCount: r?.invoiceCount ?? 0,
    },
    gstPayable: { period: months.period, amount: paise(output - input) },
    inboxPendingCount: inbox[0]?.count ?? 0,
  }
}
