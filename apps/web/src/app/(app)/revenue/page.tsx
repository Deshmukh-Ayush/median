import type { Metadata } from "next"
import { Suspense } from "react"
import { TrendingUpIcon, UsersIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import type { IsoDate } from "@workspace/contracts"
import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { Input } from "@workspace/ui/components/input"
import { Money } from "@workspace/ui/components/money"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { StatCard } from "@workspace/ui/components/stat-card"
import { StatusChip } from "@workspace/ui/components/status-chip"

import { StatementTable, isAccountId } from "@/components/reports/statement"
import { PlaceholderPage } from "@/components/shell/placeholder-page"
import { formatDate, todayIso } from "@/lib/format-date"
import type { SearchParams } from "@/lib/page-props"
import { bpsToPercentText } from "@/lib/percent"
import { dateParam, financialYearStart, journalHref } from "@/lib/report-params"
import { getDashboardSummary, getProfitAndLoss } from "@/server/services"
import type { OrgContext } from "@/server/services"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "Revenue · Median" }

const TITLE = "Revenue"
const DESCRIPTION = "Money in, by stream and customer."

function MonthSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <StatCard label="This month" loading />
      <StatCard label="Last month" loading />
    </div>
  )
}

async function ThisMonth({ ctx }: { ctx: OrgContext }) {
  let s
  try {
    s = await getDashboardSummary(ctx)
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard label="This month" error={error.message} />
        <StatCard label="Last month" error={error.message} />
      </div>
    )
  }
  const bps = s.revenueChange.percentBps
  const change =
    bps === null
      ? "No revenue last month to compare with"
      : `${bps < 0 ? "Down" : bps > 0 ? "Up" : "No change"}${
          bps === 0 ? "" : ` ${bpsToPercentText(Math.abs(bps))}%`
        } on last month`
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <StatCard
        label="This month"
        value={s.revenueThisMonth}
        compact
        caption={change}
      />
      <StatCard label="Last month" value={s.revenueLastMonth} compact />
    </div>
  )
}

async function ByStream({
  ctx,
  from,
  to,
}: {
  ctx: OrgContext
  from: IsoDate
  to: IsoDate
}) {
  let pl
  try {
    pl = await getProfitAndLoss(ctx, from, to)
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<TrendingUpIcon />}
          title="We couldn't load revenue"
          description={error.message}
        />
      </div>
    )
  }
  if (pl.totalIncome === 0n) {
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<TrendingUpIcon />}
          title="No revenue in this period"
          description="Connect Razorpay or send an invoice and your revenue shows up here."
        />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-fg-secondary">
        <Money value={pl.totalIncome} className="font-medium text-fg" /> from{" "}
        {formatDate(pl.from)} to {formatDate(pl.to)}. Each stream is an income
        account; click one for its entries.
      </p>
      <StatementTable
        title="Stream"
        sections={pl.income}
        total={pl.totalIncome}
        totalLabel="Total income"
        rowHref={(accountId) =>
          isAccountId(accountId)
            ? journalHref({ accountId, from: pl.from, to: pl.to })
            : null
        }
      />
    </div>
  )
}

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, allowed }, params] = await Promise.all([
    getPageContext("/revenue"),
    searchParams,
  ])
  if (!allowed) {
    return (
      <PlaceholderPage
        title={TITLE}
        description={DESCRIPTION}
        icon={TrendingUpIcon}
        emptyTitle=""
        emptyDescription=""
        allowed={false}
        role={ctx.role}
      />
    )
  }

  const to = dateParam(params.to) ?? todayIso()
  const fromParam = dateParam(params.from)
  const from = fromParam && fromParam <= to ? fromParam : financialYearStart(to)

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Suspense fallback={<MonthSkeleton />}>
        <ThisMonth ctx={ctx} />
      </Suspense>

      <section aria-labelledby="streams" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="streams" className="text-sm font-semibold">
            By stream
          </h2>
          <form action="/revenue" className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-fg-secondary">
              From
              <Input
                type="date"
                name="from"
                defaultValue={from}
                className="w-40"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-fg-secondary">
              To
              <Input type="date" name="to" defaultValue={to} className="w-40" />
            </label>
            <button type="submit" className={buttonVariants()}>
              Show
            </button>
          </form>
        </div>
        <Suspense
          key={`${from}:${to}`}
          fallback={<Skeleton className="h-64 rounded-lg" />}
        >
          <ByStream ctx={ctx} from={from} to={to} />
        </Suspense>
      </section>

      <section aria-labelledby="customers" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 id="customers" className="text-sm font-semibold">
            By customer
          </h2>
          <StatusChip>Coming soon</StatusChip>
        </div>
        <div className="rounded-lg border border-default bg-surface">
          <EmptyState
            icon={<UsersIcon />}
            title="Revenue by customer is on its way"
            description="Until then, Invoices shows what each customer owes you."
          />
        </div>
      </section>
    </div>
  )
}
