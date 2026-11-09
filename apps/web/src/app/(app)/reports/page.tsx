import type { Metadata } from "next"
import { Suspense } from "react"
import { PieChartIcon } from "lucide-react"

import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"

import {
  BalanceSheetView,
  ProfitAndLossView,
} from "@/components/reports/financial-statements"
import { ViewTabs } from "@/components/reports/view-tabs"
import { PlaceholderPage } from "@/components/shell/placeholder-page"
import { todayIso } from "@/lib/format-date"
import type { SearchParams } from "@/lib/page-props"
import { dateParam, financialYearStart, firstParam } from "@/lib/report-params"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "Reports · Median" }

const TITLE = "Reports"
const DESCRIPTION =
  "Profit and loss and balance sheet. Click any line for its entries."

function StatementSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-20 rounded-lg" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-72 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  )
}

const plHref = (from: string, to: string) => `/reports?from=${from}&to=${to}`
const bsHref = (asOf: string) => `/reports?view=balance-sheet&asOf=${asOf}`

function DateField({
  name,
  label,
  value,
}: {
  name: string
  label: string
  value: string
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-fg-secondary">
      {label}
      <Input type="date" name={name} defaultValue={value} className="w-40" />
    </label>
  )
}

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, allowed }, params] = await Promise.all([
    getPageContext("/reports"),
    searchParams,
  ])
  if (!allowed) {
    return (
      <PlaceholderPage
        title={TITLE}
        description={DESCRIPTION}
        icon={PieChartIcon}
        emptyTitle=""
        emptyDescription=""
        allowed={false}
        role={ctx.role}
      />
    )
  }

  const today = todayIso()
  const balanceSheet = firstParam(params.view) === "balance-sheet"
  const to = dateParam(params.to) ?? today
  const fromParam = dateParam(params.from)
  // Default: this financial year to date. A 'from' after 'to' is ignored.
  const from = fromParam && fromParam <= to ? fromParam : financialYearStart(to)
  const asOf = dateParam(params.asOf) ?? today

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <ViewTabs
        label="Reports"
        tabs={[
          {
            label: "Profit and loss",
            href: plHref(from, to),
            active: !balanceSheet,
          },
          {
            label: "Balance sheet",
            href: bsHref(asOf),
            active: balanceSheet,
          },
        ]}
      />
      {balanceSheet ? (
        <>
          <form action="/reports" className="flex items-end gap-2">
            <input type="hidden" name="view" value="balance-sheet" />
            <DateField name="asOf" label="As of" value={asOf} />
            <button type="submit" className={buttonVariants()}>
              Show
            </button>
          </form>
          <Suspense key={asOf} fallback={<StatementSkeleton />}>
            <BalanceSheetView
              ctx={ctx}
              asOf={asOf}
              profitHref={plHref(financialYearStart(asOf), asOf)}
            />
          </Suspense>
        </>
      ) : (
        <>
          <form action="/reports" className="flex flex-wrap items-end gap-2">
            <DateField name="from" label="From" value={from} />
            <DateField name="to" label="To" value={to} />
            <button type="submit" className={buttonVariants()}>
              Show
            </button>
          </form>
          <Suspense key={`${from}:${to}`} fallback={<StatementSkeleton />}>
            <ProfitAndLossView ctx={ctx} from={from} to={to} />
          </Suspense>
        </>
      )}
    </div>
  )
}
