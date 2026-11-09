import type { Metadata } from "next"
import { Suspense } from "react"
import { CalendarClockIcon, DownloadIcon, PercentIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import type { Money as MoneyValue, Period } from "@workspace/contracts"
import { paise } from "@workspace/ledger"
import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { Money } from "@workspace/ui/components/money"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { StatusChip } from "@workspace/ui/components/status-chip"
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
import { formatDate, formatPeriod, todayIso } from "@/lib/format-date"
import {
  addMonths,
  daysUntil,
  gstDeadlines,
  periodOfDate,
  periodParam,
} from "@/lib/gst-deadlines"
import type { SearchParams } from "@/lib/page-props"
import { getGstProfile, getGstSummary } from "@/server/services"
import type { GstTaxAmounts, OrgContext } from "@/server/services"

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

/** Tax amounts as cells: IGST, CGST, SGST, total. */
function TaxCells({ t }: { t: GstTaxAmounts }) {
  return (
    <>
      <TableCell numeric>
        <Money value={t.igst} />
      </TableCell>
      <TableCell numeric>
        <Money value={t.cgst} />
      </TableCell>
      <TableCell numeric>
        <Money value={t.sgst} />
      </TableCell>
      <TableCell numeric className="font-medium">
        <Money value={t.total} />
      </TableCell>
    </>
  )
}

/** A negative net is credit carried forward: shown positive, labelled so. */
function NetLine({ label, value }: { label: string; value: MoneyValue }) {
  const raw: bigint = value
  const credit = raw < 0n
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-fg-secondary">
        {label}
        {credit ? " (credit carried forward)" : ""}
      </span>
      <Money value={credit ? paise(-raw) : value} className="font-medium" />
    </div>
  )
}

async function Summary({ ctx, period }: { ctx: OrgContext; period: Period }) {
  let s
  try {
    s = await getGstSummary(ctx, period)
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<PercentIcon />}
          title="We couldn't load the GST summary"
          description={error.message}
        />
      </div>
    )
  }

  const payable: bigint = s.netPayable.total
  const carried = payable < 0n

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-default bg-surface px-5 py-4">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-xs text-fg-secondary">
            {carried ? "Tax credit carried forward" : "Tax to pay"} for{" "}
            {formatPeriod(s.period)}
            {s.isLocked ? (
              <StatusChip tone="success">Locked</StatusChip>
            ) : (
              <StatusChip tone="warning">Open: can still change</StatusChip>
            )}
          </span>
          <Money
            value={carried ? paise(-payable) : s.netPayable.total}
            className="text-2xl font-semibold"
          />
        </div>
        <div className="flex gap-6">
          <NetLine label="IGST" value={s.netPayable.igst} />
          <NetLine label="CGST" value={s.netPayable.cgst} />
          <NetLine label="SGST" value={s.netPayable.sgst} />
        </div>
      </div>

      <div className="rounded-lg border border-default bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>GSTR-3B</TableHead>
              <TableHead numeric>Taxable value</TableHead>
              <TableHead numeric>IGST</TableHead>
              <TableHead numeric>CGST</TableHead>
              <TableHead numeric>SGST</TableHead>
              <TableHead numeric>Total tax</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.outward.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="text-fg-secondary">
                  No taxable sales this month.
                </TableCell>
              </TableRow>
            ) : (
              s.outward.map((row) => (
                <TableRow key={row.rateBps}>
                  <TableCell className="pl-6">
                    Sales at {row.rateBps / 100}%
                  </TableCell>
                  <TableCell numeric>
                    <Money value={row.taxable} />
                  </TableCell>
                  <TaxCells t={row} />
                </TableRow>
              ))
            )}
            <TableRow className="hover:bg-transparent">
              <TableCell className="font-medium">
                3.1(a) Output tax on sales
              </TableCell>
              <TableCell numeric className="font-medium">
                <Money value={s.outwardTotal.taxable} />
              </TableCell>
              <TaxCells t={s.outwardTotal} />
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableCell className="font-medium">
                4(A)(5) Input tax credit on purchases
              </TableCell>
              <TableCell />
              <TaxCells t={s.inputTaxCredit} />
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={2}>
                Net: output tax minus input tax credit
              </TableCell>
              <TableCell numeric>
                <Money value={s.netPayable.igst} variant="ledger" />
              </TableCell>
              <TableCell numeric>
                <Money value={s.netPayable.cgst} variant="ledger" />
              </TableCell>
              <TableCell numeric>
                <Money value={s.netPayable.sgst} variant="ledger" />
              </TableCell>
              <TableCell numeric>
                <Money value={s.netPayable.total} variant="ledger" />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
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
        <Summary ctx={ctx} period={period} />
      </Suspense>

      <section aria-labelledby="returns" className="flex flex-col gap-3">
        <h2 id="returns" className="text-sm font-semibold">
          Returns for {formatPeriod(period)}
        </h2>
        <div className="flex flex-col gap-2 rounded-lg border border-default bg-surface px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-disabled
              className={buttonVariants({
                size: "sm",
                className: "pointer-events-none opacity-50",
              })}
            >
              <DownloadIcon aria-hidden />
              Download GSTR-1 (draft)
            </span>
            <StatusChip>Coming soon</StatusChip>
          </div>
          <p className="text-xs text-fg-secondary">
            This is a draft. Your CA checks it in the GST offline tool before
            filing; Median doesn&apos;t file returns for you.
          </p>
        </div>
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
