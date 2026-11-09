import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { BookOpenIcon } from "lucide-react"

import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { Journal } from "@/components/ledger/journal"
import { TrialBalanceView } from "@/components/ledger/trial-balance"
import { ViewTabs } from "@/components/reports/view-tabs"
import { PlaceholderPage } from "@/components/shell/placeholder-page"
import { todayIso } from "@/lib/format-date"
import type { SearchParams } from "@/lib/page-props"
import { can } from "@/lib/permissions"
import {
  JOURNAL_SOURCES,
  SOURCE_LABELS,
  dateParam,
  firstParam,
  idParam,
  journalHref,
  sourceParam,
  trialBalanceHref,
} from "@/lib/report-params"
import type { JournalLink } from "@/lib/report-params"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "Ledger · Median" }

const TITLE = "Ledger"
const DESCRIPTION = "The journal and trial balance, in debits and credits."

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-default bg-surface p-3">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-8" />
      ))}
    </div>
  )
}

const selectClass =
  "h-8 rounded-sm border border-input bg-surface px-2 text-sm text-fg"

function JournalFilters({ filters }: { filters: JournalLink }) {
  return (
    <form
      action="/ledger"
      className="flex flex-wrap items-end gap-2"
      aria-label="Filter entries"
    >
      {filters.accountId ? (
        <input type="hidden" name="account" value={filters.accountId} />
      ) : null}
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">
        From
        <Input
          type="date"
          name="from"
          defaultValue={filters.from}
          className="w-40"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">
        To
        <Input
          type="date"
          name="to"
          defaultValue={filters.to}
          className="w-40"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">
        Source
        <select
          name="source"
          defaultValue={filters.source ?? ""}
          className={selectClass}
        >
          <option value="">All sources</option>
          {JOURNAL_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">
        Narration
        <Input
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder="Search"
          maxLength={100}
          className="w-48"
        />
      </label>
      <button type="submit" className={buttonVariants({ size: "default" })}>
        Apply
      </button>
      {filters.accountId ||
      filters.from ||
      filters.to ||
      filters.source ||
      filters.q ? (
        <Link href="/ledger" className={buttonVariants({ variant: "ghost" })}>
          Clear
        </Link>
      ) : null}
    </form>
  )
}

function AsOfForm({ asOf }: { asOf: string }) {
  return (
    <form
      action="/ledger"
      className="flex items-end gap-2"
      aria-label="Trial balance date"
    >
      <input type="hidden" name="view" value="trial-balance" />
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">
        As of
        <Input type="date" name="asOf" defaultValue={asOf} className="w-40" />
      </label>
      <button type="submit" className={buttonVariants()}>
        Show
      </button>
    </form>
  )
}

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, allowed }, params] = await Promise.all([
    getPageContext("/ledger"),
    searchParams,
  ])
  if (!allowed) {
    return (
      <PlaceholderPage
        title={TITLE}
        description={DESCRIPTION}
        icon={BookOpenIcon}
        emptyTitle=""
        emptyDescription=""
        allowed={false}
        role={ctx.role}
      />
    )
  }

  const showTb =
    firstParam(params.view) === "trial-balance" &&
    can(ctx.role, { resource: "report", action: "read" })
  const asOf = dateParam(params.asOf) ?? todayIso()
  const filters: JournalLink = {
    accountId: idParam(params.account),
    from: dateParam(params.from),
    to: dateParam(params.to),
    source: sourceParam(params.source),
    q: firstParam(params.q)?.slice(0, 100),
    cursor: firstParam(params.cursor),
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <ViewTabs
        label="Ledger views"
        tabs={[
          { label: "Journal", href: journalHref(), active: !showTb },
          ...(can(ctx.role, { resource: "report", action: "read" })
            ? [
                {
                  label: "Trial balance",
                  href: trialBalanceHref(),
                  active: showTb,
                },
              ]
            : []),
        ]}
      />
      {showTb ? (
        <>
          <AsOfForm asOf={asOf} />
          <Suspense key={asOf} fallback={<TableSkeleton />}>
            <TrialBalanceView ctx={ctx} asOf={asOf} />
          </Suspense>
        </>
      ) : (
        <>
          <JournalFilters filters={filters} />
          <Suspense key={journalHref(filters)} fallback={<TableSkeleton />}>
            <Journal ctx={ctx} filters={filters} />
          </Suspense>
        </>
      )}
    </div>
  )
}
