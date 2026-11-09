import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { LandmarkIcon, UploadIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import type { CashAccountPosition, IsoDate } from "@workspace/contracts"
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
import { getCashPosition } from "@/server/services"
import type { OrgContext } from "@/server/services"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "Cash · Median" }

const TITLE = "Cash"
const DESCRIPTION = "Bank and Razorpay balances, and what's reconciled."

const KIND_LABELS: Record<CashAccountPosition["kind"], string> = {
  bank: "Bank",
  razorpay: "Razorpay",
  cash: "Cash",
}

function Reconciliation({ a }: { a: CashAccountPosition }) {
  if (a.kind === "cash") return <span className="text-fg-tertiary">—</span>
  if (a.matched.count === 0 && a.unmatched.count === 0) {
    return (
      <span className="text-xs text-fg-secondary">
        {a.kind === "bank" ? "No statement yet" : "Nothing synced yet"}
      </span>
    )
  }
  return (
    <div className="flex flex-col items-start gap-0.5">
      {a.unmatched.count === 0 ? (
        <StatusChip tone="success" dot>
          All {a.matched.count} lines reconciled
        </StatusChip>
      ) : (
        <Link href="/inbox" className="hover:underline">
          <StatusChip tone="warning" dot>
            {a.unmatched.count} to review
          </StatusChip>
        </Link>
      )}
      <span className="text-xs text-fg-secondary">
        {a.matched.count} matched
        {a.unmatched.count > 0 ? (
          <>
            {" "}
            · <Money
              value={a.unmatched.amount}
              className="text-fg-secondary"
            />{" "}
            waiting
          </>
        ) : null}
      </span>
    </div>
  )
}

/** Each bank, Razorpay and cash account from getCashPosition. */
async function Position({ ctx, asOf }: { ctx: OrgContext; asOf: IsoDate }) {
  let p
  try {
    p = await getCashPosition(ctx, asOf)
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<LandmarkIcon />}
          title="We couldn't load your cash"
          description={error.message}
        />
      </div>
    )
  }

  if (p.accounts.length === 0) {
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

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-sm">
        <StatCard
          label="Cash in bank and Razorpay"
          value={p.total}
          compact
          tone={p.total < 0n ? "danger" : "default"}
          caption={`As of ${formatDate(p.asOf)}`}
        />
      </div>
      <div className="rounded-lg border border-default bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Account</TableHead>
              <TableHead className="w-28">Type</TableHead>
              <TableHead numeric className="w-40">
                Balance
              </TableHead>
              <TableHead className="w-40">Last statement</TableHead>
              <TableHead className="w-56">Reconciliation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.accounts.map((a) => {
              const href = journalHref({ accountId: a.accountId, to: p.asOf })
              return (
                <TableRow key={a.accountId} className="align-top">
                  <TableCell className="py-2 whitespace-normal">
                    <Link href={href} className="hover:underline">
                      <span className="text-fg-secondary tabular">
                        {a.code}
                      </span>{" "}
                      {a.name}
                    </Link>
                    {a.bankName || a.accountLast4 ? (
                      <span className="block text-xs text-fg-secondary">
                        {[
                          a.bankName,
                          a.accountLast4 ? `····${a.accountLast4}` : null,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="py-2 text-fg-secondary">
                    {KIND_LABELS[a.kind]}
                  </TableCell>
                  <TableCell numeric className="py-2">
                    <Link href={href} className="hover:underline">
                      <Money
                        value={a.balance}
                        tone={a.balance < 0n ? "danger" : "default"}
                      />
                    </Link>
                  </TableCell>
                  <TableCell className="py-2 text-fg-secondary">
                    {a.lastStatementDate
                      ? formatDate(a.lastStatementDate)
                      : "—"}
                    {a.lastSyncedAt ? (
                      <span className="block text-xs">
                        Synced {formatDateTime(a.lastSyncedAt)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="py-2">
                    <Reconciliation a={a} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
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
      <Suspense fallback={<Skeleton className="h-64 rounded-lg" />}>
        <Position ctx={ctx} asOf={todayIso()} />
      </Suspense>
    </div>
  )
}
