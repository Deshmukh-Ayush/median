import type { Metadata } from "next"
import { Suspense } from "react"
import { CalendarClockIcon, PercentIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import type { Period } from "@workspace/contracts"
import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { GstSummaryView } from "@/components/gst/gst-summary"
import { Gstr1Draft } from "@/components/gst/gstr1-draft"
import { PlaceholderPage } from "@/components/shell/placeholder-page"
import { formatDate, formatPeriod, todayIso } from "@/lib/format-date"
import {
  addMonths,
  daysUntil,
  gstDeadlines,
  periodOfDate,
  periodParam,
} from "@/lib/gst-deadlines"
import type { SearchParams } from "@/lib/page-props"
import { can } from "@/lib/permissions"
import { getGstProfile } from "@/server/services"
import type { OrgContext } from "@/server/services"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "GST · Median" }

const TITLE = "GST"
const DESCRIPTION = "Tax due each month, returns and deadlines."

function SummarySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-24 rounded-lg" />
      <Skeleton className="h-56 rounded-lg" />
    </div>
  )
}

async function Deadlines({
  ctx,
  period,
  today,
}: {
  ctx: OrgContext
  period: Period
  today: string
}) {
  let profile
  try {
    profile = await getGstProfile(ctx)
  } catch (error) {
    if (!isServiceError(error)) throw error
    return <p className="text-sm text-danger">{error.message}</p>
  }
  const deadlines = gstDeadlines(period, profile)
  if (deadlines.length === 0) {
    return (
      <p className="text-sm text-fg-secondary">
        Your organisation isn&apos;t registered for GST, so there are no returns
        to file.
      </p>
    )
  }
  return (
    <ul className="flex flex-col divide-y divide-subtle rounded-lg border border-default bg-surface">
      {deadlines.map((d) => {
        const days = daysUntil(today, d.due)
        return (
          <li key={d.form} className="flex items-center gap-4 px-4 py-3">
            <CalendarClockIcon
              aria-hidden
              className="size-4 shrink-0 text-fg-secondary"
            />
            <div className="flex flex-1 flex-col">
              <span className="text-sm font-medium">{d.form}</span>
              <span className="text-xs text-fg-secondary">{d.description}</span>
            </div>
            <div className="flex flex-col items-end gap-0.5 text-sm">
              <span className="tabular">{formatDate(d.due)}</span>
              <span
                className={
                  days >= 0 && days <= 5
                    ? "text-xs text-warning"
                    : "text-xs text-fg-secondary"
                }
              >
                {days > 1
                  ? `in ${days} days`
                  : days === 1
                    ? "tomorrow"
                    : days === 0
                      ? "today"
                      : "date has passed"}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, allowed }, params] = await Promise.all([
    getPageContext("/gst"),
    searchParams,
  ])
  if (!allowed) {
    return (
      <PlaceholderPage
        title={TITLE}
        description={DESCRIPTION}
        icon={PercentIcon}
        emptyTitle=""
        emptyDescription=""
        allowed={false}
        role={ctx.role}
      />
    )
  }

  const today = todayIso()
  const thisMonth = periodOfDate(today)
  // Returns are filed for last month, so that's the default.
  const period = periodParam(params.period) ?? addMonths(thisMonth, -1)
  const months = Array.from({ length: 13 }, (_, i) => addMonths(thisMonth, -i))

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
          <form action="/gst" className="flex items-center gap-2">
            <label htmlFor="period" className="sr-only">
              Month
            </label>
            <select
              id="period"
              name="period"
              defaultValue={period}
              className="h-8 rounded-sm border border-input bg-surface px-2 text-sm"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatPeriod(m)}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonVariants({ size: "sm" })}>
              Show
            </button>
          </form>
        }
      />

      <Suspense key={period} fallback={<SummarySkeleton />}>
        <GstSummaryView ctx={ctx} period={period} />
      </Suspense>

      <section aria-labelledby="returns" className="flex flex-col gap-3">
        <h2 id="returns" className="text-sm font-semibold">
          Returns for {formatPeriod(period)}
        </h2>
        <Suspense key={`g:${period}`} fallback={<Skeleton className="h-20" />}>
          <Gstr1Draft
            ctx={ctx}
            period={period}
            canExport={can(ctx.role, { resource: "report", action: "export" })}
          />
        </Suspense>
        <Suspense key={`d:${period}`} fallback={<Skeleton className="h-24" />}>
          <Deadlines ctx={ctx} period={period} today={today} />
        </Suspense>
        <p className="text-xs text-fg-secondary">
          Standard due dates for monthly filers. If you file quarterly under
          QRMP, or the government extends a date, yours will differ.
        </p>
      </section>
    </div>
  )
}
