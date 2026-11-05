import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { InboxIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import { paise } from "@workspace/ledger"
import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { Money } from "@workspace/ui/components/money"
import { StatCard } from "@workspace/ui/components/stat-card"

import { AppLink } from "@/components/app-link"
import { formatDateTime, formatPeriod } from "@/lib/format-date"
import { canOpen } from "@/lib/navigation"
import { getDashboardSummary } from "@/server/services"
import type { OrgContext } from "@/server/services"

import { getOrgContextOrRedirect } from "./org-context"

export const metadata: Metadata = { title: "Home · Median" }

const CARDS = ["Money in", "Owed to you", "Tax due", "Cash in bank"] as const

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {children}
    </div>
  )
}

function SummarySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Grid>
        {CARDS.map((label) => (
          <StatCard key={label} label={label} loading />
        ))}
      </Grid>
    </div>
  )
}

async function Summary({ ctx }: { ctx: OrgContext }) {
  let summary: Awaited<ReturnType<typeof getDashboardSummary>>
  try {
    summary = await getDashboardSummary(ctx)
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <Grid>
        {CARDS.map((label) => (
          <StatCard key={label} label={label} error={error.message} />
        ))}
      </Grid>
    )
  }

  const { receivables, gstPayable } = summary
  // Negative GST payable is input tax credit carried forward: show it as a
  // positive "Tax credit" rather than a minus sign.
  const gst: bigint = gstPayable.amount
  const hasCredit = gst < 0n
  const gstShown = paise(hasCredit ? -gst : gst)
  const showInbox = summary.inboxPendingCount > 0 && canOpen(ctx.role, "/inbox")

  return (
    <div className="flex flex-col gap-4">
      {showInbox ? (
        <div className="flex items-center gap-3 rounded-lg border border-default bg-surface px-4 py-3">
          <InboxIcon
            aria-hidden
            className="size-4 shrink-0 text-fg-secondary"
          />
          <p className="flex-1 text-sm">
            <span className="font-medium tabular">
              {summary.inboxPendingCount}
            </span>{" "}
            {summary.inboxPendingCount === 1 ? "item is" : "items are"} waiting
            for your review in the AI inbox.
          </p>
          <Link
            href="/inbox"
            className={buttonVariants({ variant: "primary", size: "sm" })}
          >
            Review
          </Link>
        </div>
      ) : null}

      <Grid>
        <StatCard
          label="Money in"
          href="/revenue"
          linkComponent={AppLink}
          value={summary.revenueThisMonth}
          compact
          caption={
            <>
              <Money
                value={summary.revenueLastMonth}
                compact
                className="text-fg-secondary"
              />{" "}
              last month
            </>
          }
        />
        <StatCard
          label="Owed to you"
          href="/invoices"
          linkComponent={AppLink}
          value={receivables.outstanding}
          compact
          caption={
            receivables.overdue > 0n ? (
              <>
                <Money value={receivables.overdue} compact tone="danger" />{" "}
                overdue · {receivables.invoiceCount}{" "}
                {receivables.invoiceCount === 1 ? "invoice" : "invoices"}
              </>
            ) : (
              <>
                {receivables.invoiceCount}{" "}
                {receivables.invoiceCount === 1 ? "invoice" : "invoices"} unpaid
              </>
            )
          }
        />
        <StatCard
          label={hasCredit ? "Tax credit" : "Tax due"}
          href="/gst"
          linkComponent={AppLink}
          value={gstShown}
          compact
          caption={
            hasCredit
              ? `GST for ${formatPeriod(gstPayable.period)}, carried forward`
              : `GST for ${formatPeriod(gstPayable.period)}`
          }
        />
        <StatCard
          label="Cash in bank"
          href="/cash"
          linkComponent={AppLink}
          value={summary.cash}
          compact
          tone={summary.cash < 0n ? "danger" : "default"}
          caption="Bank and Razorpay"
        />
      </Grid>

      <p className="text-xs text-fg-secondary">
        Updated {formatDateTime(summary.asOf)}. Click any number to see the
        entries behind it.
      </p>
    </div>
  )
}

export default async function HomePage() {
  const ctx = await getOrgContextOrRedirect()
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="Home" description="Your money at a glance." />
      <Suspense fallback={<SummarySkeleton />}>
        <Summary ctx={ctx} />
      </Suspense>
    </div>
  )
}
