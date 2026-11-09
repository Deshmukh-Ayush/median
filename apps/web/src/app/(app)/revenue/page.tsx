import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { TrendingUpIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import type { IsoDate } from "@workspace/contracts"
import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { Input } from "@workspace/ui/components/input"
import { Money } from "@workspace/ui/components/money"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { StatCard } from "@workspace/ui/components/stat-card"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { PlaceholderPage } from "@/components/shell/placeholder-page"
import { formatDate, todayIso } from "@/lib/format-date"
import type { SearchParams } from "@/lib/page-props"
import { bpsToPercentText } from "@/lib/percent"
import {
  dateParam,
  financialYearStart,
  firstParam,
  journalHref,
} from "@/lib/report-params"
import { getDashboardSummary, getRevenueBreakdown } from "@/server/services"
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

interface Range {
  readonly from: IsoDate
  readonly to: IsoDate
}

const pageHref = (r: Range, customers: string | null) => {
  const q = new URLSearchParams({ from: r.from, to: r.to })
  if (customers) q.set("customers", customers)
  return `/revenue?${q.toString()}`
}

/** Revenue by stream and by customer, both from getRevenueBreakdown. */
async function Breakdown({
  ctx,
  range,
  cursor,
}: {
  ctx: OrgContext
  range: Range
  cursor: string | null
}) {
  let b
  try {
    b = await getRevenueBreakdown(ctx, range.from, range.to, cursor)
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
  if (b.total === 0n) {
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
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-secondary">
        <Money value={b.total} className="font-medium text-fg" /> revenue from
        operations, {formatDate(b.from)} to {formatDate(b.to)}. GST isn&apos;t
        included.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        <section aria-labelledby="streams" className="flex flex-col gap-2">
          <h2 id="streams" className="text-sm font-semibold">
            By stream
          </h2>
          <div className="rounded-lg border border-default bg-surface">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Stream</TableHead>
                  <TableHead numeric className="w-40">
                    Revenue
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.byStream.map((s) => {
                  const href = journalHref({
                    accountId: s.accountId,
                    from: b.from,
                    to: b.to,
                  })
                  return (
                    <TableRow key={s.accountId}>
                      <TableCell>
                        <Link href={href} className="hover:underline">
                          <span className="text-fg-secondary tabular">
                            {s.code}
                          </span>{" "}
                          {s.name}
                        </Link>
                      </TableCell>
                      <TableCell numeric>
                        <Link href={href} className="hover:underline">
                          <Money value={s.revenue} />
                        </Link>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell>Total</TableCell>
                  <TableCell numeric>
                    <Money value={b.total} />
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </section>

        <section aria-labelledby="customers" className="flex flex-col gap-2">
          <h2 id="customers" className="text-sm font-semibold">
            By customer
          </h2>
          <div className="rounded-lg border border-default bg-surface">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Customer</TableHead>
                  <TableHead numeric className="w-20">
                    Invoices
                  </TableHead>
                  <TableHead numeric className="w-40">
                    Revenue
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.byCustomer.map((c) => (
                  <TableRow key={c.party.id}>
                    <TableCell>
                      <Link
                        href={`/invoices?customer=${c.party.id}`}
                        className="hover:underline"
                      >
                        {c.party.name}
                      </Link>
                    </TableCell>
                    <TableCell numeric className="text-fg-secondary">
                      {c.invoiceCount}
                    </TableCell>
                    <TableCell numeric>
                      <Money value={c.revenue} />
                    </TableCell>
                  </TableRow>
                ))}
                {b.withoutCustomer !== 0n && !b.nextCursor ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-fg-secondary">
                      No customer (payments without an invoice, manual entries)
                    </TableCell>
                    <TableCell numeric>
                      <Money value={b.withoutCustomer} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          {cursor || b.nextCursor ? (
            <nav aria-label="Customer pages" className="flex justify-end gap-2">
              {cursor ? (
                <Link
                  href={pageHref(range, null)}
                  className={buttonVariants({ size: "sm" })}
                >
                  Top customers
                </Link>
              ) : null}
              {b.nextCursor ? (
                <Link
                  href={pageHref(range, b.nextCursor)}
                  className={buttonVariants({ size: "sm" })}
                >
                  More customers
                </Link>
              ) : null}
            </nav>
          ) : null}
        </section>
      </div>
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
  const cursor = firstParam(params.customers) ?? null

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
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
        }
      />
      <Suspense fallback={<MonthSkeleton />}>
        <ThisMonth ctx={ctx} />
      </Suspense>
      <Suspense
        key={`${from}:${to}:${cursor}`}
        fallback={<Skeleton className="h-64 rounded-lg" />}
      >
        <Breakdown ctx={ctx} range={{ from, to }} cursor={cursor} />
      </Suspense>
    </div>
  )
}
