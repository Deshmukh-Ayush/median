import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { LandmarkIcon, ListChecksIcon, UploadIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import type { IsoDate } from "@workspace/contracts"
import { paise } from "@workspace/ledger"
import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { Money } from "@workspace/ui/components/money"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { StatCard } from "@workspace/ui/components/stat-card"
import { StatusChip } from "@workspace/ui/components/status-chip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { PlaceholderPage } from "@/components/shell/placeholder-page"
import { formatDate, formatDateTime, todayIso } from "@/lib/format-date"
import { journalHref } from "@/lib/report-params"
import {
  getDashboardSummary,
  getTrialBalance,
  listLedgerAccounts,
} from "@/server/services"
import type { OrgContext } from "@/server/services"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "Cash · Median" }

const TITLE = "Cash"
const DESCRIPTION = "Bank and Razorpay balances, and what's reconciled."

async function TotalCash({ ctx }: { ctx: OrgContext }) {
  let s
  try {
    s = await getDashboardSummary(ctx)
  } catch (error) {
    if (!isServiceError(error)) throw error
    return <StatCard label="Cash in bank and Razorpay" error={error.message} />
  }
  return (
    <StatCard
      label="Cash in bank and Razorpay"
      value={s.cash}
      compact
      tone={s.cash < 0n ? "danger" : "default"}
      caption={`Updated ${formatDateTime(s.asOf)}`}
    />
  )
}

/**
 * Each bank account's closing balance, from the trial balance. Rows are
 * matched by account code (unique per organisation); nothing is added up.
 */
async function BankBalances({ ctx, asOf }: { ctx: OrgContext; asOf: IsoDate }) {
  let banks, tb
  try {
    ;[banks, tb] = await Promise.all([
      listLedgerAccounts(ctx, null, { bankOnly: true }, { limit: 100 }),
      getTrialBalance(ctx, asOf),
    ])
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<LandmarkIcon />}
          title="We couldn't load your bank balances"
          description={error.message}
        />
      </div>
    )
  }

  if (banks.items.length === 0) {
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<LandmarkIcon />}
          title="No bank accounts yet"
          description="Add a bank account and upload its statement to see your cash."
          action={
            <Link
              href="/cash/upload"
              className={buttonVariants({ size: "sm" })}
            >
              Add a bank account
            </Link>
          }
        />
      </div>
    )
  }

  const byCode = new Map(tb.rows.map((r) => [r.code, r]))

  return (
    <div className="rounded-lg border border-default bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Account</TableHead>
            <TableHead>Bank</TableHead>
            <TableHead numeric className="w-44">
              Balance on {formatDate(tb.asOf)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {banks.items.map((a) => {
            const row = byCode.get(a.code)
            // A bank is an asset: a credit balance is an overdraft, shown
            // as a negative amount (a sign flip, not a sum).
            const credit: bigint = row?.credit ?? 0n
            const overdrawn = credit > 0n
            const balance = overdrawn
              ? paise(-credit)
              : (row?.debit ?? paise(0n))
            const href = journalHref({ accountId: a.id, to: tb.asOf })
            return (
              <TableRow key={a.id}>
                <TableCell>
                  <Link href={href} className="hover:underline">
                    <span className="text-fg-secondary tabular">{a.code}</span>{" "}
                    {a.name}
                  </Link>
                </TableCell>
                <TableCell className="text-fg-secondary">
                  {[a.bankName, a.accountLast4 ? `····${a.accountLast4}` : null]
                    .filter(Boolean)
                    .join(" ") || "—"}
                </TableCell>
                <TableCell numeric>
                  <Link href={href} className="hover:underline">
                    <Money
                      value={balance}
                      tone={overdrawn ? "danger" : "default"}
                    />
                  </Link>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export default async function Page() {
  const { ctx, allowed } = await getPageContext("/cash")
  if (!allowed) {
    return (
      <PlaceholderPage
        title={TITLE}
        description={DESCRIPTION}
        icon={LandmarkIcon}
        emptyTitle=""
        emptyDescription=""
        allowed={false}
        role={ctx.role}
      />
    )
  }
  const today = todayIso()

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
          <Link href="/cash/upload" className={buttonVariants({ size: "sm" })}>
            <UploadIcon aria-hidden />
            Upload bank statement
          </Link>
        }
      />
      <div className="max-w-sm">
        <Suspense
          fallback={<StatCard label="Cash in bank and Razorpay" loading />}
        >
          <TotalCash ctx={ctx} />
        </Suspense>
      </div>

      <section aria-labelledby="banks" className="flex flex-col gap-3">
        <h2 id="banks" className="text-sm font-semibold">
          Bank accounts
        </h2>
        <Suspense fallback={<Skeleton className="h-32 rounded-lg" />}>
          <BankBalances ctx={ctx} asOf={today} />
        </Suspense>
      </section>

      <section aria-labelledby="reconciliation" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 id="reconciliation" className="text-sm font-semibold">
            Reconciliation
          </h2>
          <StatusChip>Coming soon</StatusChip>
        </div>
        <div className="rounded-lg border border-default bg-surface">
          <EmptyState
            icon={<ListChecksIcon />}
            title="Reconciliation status is on its way"
            description="Bank lines that need a decision are already in the AI inbox."
            action={
              <Link href="/inbox" className={buttonVariants({ size: "sm" })}>
                Open AI inbox
              </Link>
            }
          />
        </div>
      </section>
    </div>
  )
}
