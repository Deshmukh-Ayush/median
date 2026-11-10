import type { Metadata } from "next"
import { Suspense } from "react"
import { BookOpenIcon, DownloadIcon, LockIcon } from "lucide-react"

import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { AuditLog } from "@/components/ledger/audit-log"
import { LedgerTabs } from "@/components/ledger/ledger-tabs"
import { LockPeriodForm } from "@/components/ledger/lock-period-form"
import { PlaceholderPage } from "@/components/shell/placeholder-page"
import { formatDateTime, formatPeriod, todayIso } from "@/lib/format-date"
import { addMonths, periodOfDate } from "@/lib/gst-deadlines"
import type { SearchParams } from "@/lib/page-props"
import { can, whoCan } from "@/lib/permissions"
import { dateParam, financialYearStart, firstParam } from "@/lib/report-params"

import { listPeriodLocks } from "@/server/services"
import type { OrgContext } from "@/server/services"

import { getPageContext } from "../../org-context"
import { lockPeriodAction } from "./actions"

export const metadata: Metadata = { title: "CA review · Ledger · Median" }

const TITLE = "Ledger"
const DESCRIPTION = "Lock months, export to Tally and see every change."

/** Months offered for locking: the last 12 that have ended (IST). */
const LOCKABLE_MONTHS = 12

/**
 * Locked months, and the picker for the next one. Only ended months that
 * aren't locked yet are offered; lockPeriod rejects the rest anyway.
 */
async function LockMonths({
  ctx,
  today,
  canLock,
}: {
  ctx: OrgContext
  today: string
  canLock: boolean
}) {
  const locks = await listPeriodLocks(ctx, null, { limit: 24 })
  const locked = new Set(locks.items.map((l) => l.period))
  const thisMonth = periodOfDate(today)
  const months = Array.from({ length: LOCKABLE_MONTHS }, (_, i) =>
    addMonths(thisMonth, -(i + 1))
  )
    .filter((p) => !locked.has(p))
    .map((p) => [p, formatPeriod(p)] as const)

  return (
    <div className="flex flex-col gap-3">
      {!canLock ? (
        <p className="text-sm text-fg-secondary">
          Only {whoCan({ resource: "period", action: "lock" })} can lock months.
        </p>
      ) : months.length > 0 ? (
        <LockPeriodForm
          months={months}
          lockPeriod={lockPeriodAction}
          unlockers={whoCan({ resource: "period", action: "unlock" })}
        />
      ) : (
        <p className="text-sm text-fg-secondary">
          Every month in the last year is locked.
        </p>
      )}
      {locks.items.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-fg-secondary">Locked</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {locks.items.map((l) => (
              <li key={l.period} className="flex items-center gap-2">
                <LockIcon aria-hidden className="size-3.5 text-fg-secondary" />
                <span className="font-medium">{formatPeriod(l.period)}</span>
                <span className="text-fg-secondary">
                  by {l.lockedBy.name}, {formatDateTime(l.lockedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-lg border border-default bg-surface p-5"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        <p className="text-xs text-fg-secondary">{description}</p>
      </div>
      {children}
    </section>
  )
}

const tallyHref = (from: string, to: string, file: "masters" | "vouchers") =>
  `/ledger/review/tally?from=${from}&to=${to}&file=${file}`

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

  const today = todayIso()
  const to = dateParam(params.to) ?? today
  const fromParam = dateParam(params.from)
  const from = fromParam && fromParam <= to ? fromParam : financialYearStart(to)
  const auditCursor = firstParam(params.audit) ?? null
  const canLock = can(ctx.role, { resource: "period", action: "lock" })
  const canExport = can(ctx.role, { resource: "report", action: "export" })

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <LedgerTabs role={ctx.role} active="review" />

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          id="lock"
          title="Lock a month"
          description="Once your CA has reviewed a month, lock it so the numbers can't change."
        >
          <Suspense fallback={<Skeleton className="h-16 w-full" />}>
            <LockMonths ctx={ctx} today={today} canLock={canLock} />
          </Suspense>
        </Section>

        <Section
          id="tally"
          title="Export to Tally"
          description="Two XML files for Gateway of Tally → Import: masters first (ledgers and opening balances), then vouchers."
        >
          {canExport ? (
            <>
              <form
                action="/ledger/review"
                className="flex flex-wrap items-end gap-2"
              >
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
                  <Input
                    type="date"
                    name="to"
                    defaultValue={to}
                    className="w-40"
                  />
                </label>
                <button
                  type="submit"
                  className={buttonVariants({ variant: "ghost" })}
                >
                  Set range
                </button>
              </form>
              <div className="flex flex-wrap gap-2">
                <a
                  href={tallyHref(from, to, "masters")}
                  download
                  className={buttonVariants({ size: "sm" })}
                >
                  <DownloadIcon aria-hidden />
                  1. Masters
                </a>
                <a
                  href={tallyHref(from, to, "vouchers")}
                  download
                  className={buttonVariants({ size: "sm" })}
                >
                  <DownloadIcon aria-hidden />
                  2. Vouchers
                </a>
              </div>
            </>
          ) : (
            <p className="text-sm text-fg-secondary">
              Your role can&apos;t export the books.
            </p>
          )}
        </Section>
      </div>

      <section aria-labelledby="audit" className="flex flex-col gap-3">
        <h2 id="audit" className="text-sm font-semibold">
          Audit log
        </h2>
        <Suspense
          key={auditCursor ?? "first"}
          fallback={<Skeleton className="h-64 rounded-lg" />}
        >
          <AuditLog
            ctx={ctx}
            cursor={auditCursor}
            pageHref={(c) => {
              const q = new URLSearchParams({ from, to })
              if (c) q.set("audit", c)
              return `/ledger/review?${q.toString()}#audit`
            }}
          />
        </Suspense>
      </section>
    </div>
  )
}
