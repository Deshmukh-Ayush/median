import Link from "next/link"
import { PieChartIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import type { IsoDate } from "@workspace/contracts"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { Money } from "@workspace/ui/components/money"
import { StatusChip } from "@workspace/ui/components/status-chip"

import { formatDate } from "@/lib/format-date"
import { journalHref } from "@/lib/report-params"
import { getBalanceSheet, getProfitAndLoss } from "@/server/services"
import type { OrgContext } from "@/server/services"

import { StatementTable, isAccountId } from "./statement"

function LoadError({ what, message }: { what: string; message: string }) {
  return (
    <div className="rounded-lg border border-default bg-surface">
      <EmptyState
        icon={<PieChartIcon />}
        title={`We couldn't load the ${what}`}
        description={message}
      />
    </div>
  )
}

/** Profit and loss for a period, Schedule III order. */
export async function ProfitAndLossView({
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
    return <LoadError what="profit and loss" message={error.message} />
  }

  const href = (accountId: string) =>
    isAccountId(accountId)
      ? journalHref({ accountId, from: pl.from, to: pl.to })
      : null
  const loss = pl.netProfit < 0n

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-default bg-surface px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-fg-secondary">
            {loss ? "Net loss" : "Net profit"}, {formatDate(pl.from)} –{" "}
            {formatDate(pl.to)}
          </span>
          <Money
            value={pl.netProfit}
            className="text-2xl font-semibold"
            tone={loss ? "danger" : "default"}
          />
        </div>
        <span className="text-sm text-fg-secondary">
          Income <Money value={pl.totalIncome} compact /> · Expenses{" "}
          <Money value={pl.totalExpenses} compact />
        </span>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <StatementTable
          title="Income"
          sections={pl.income}
          total={pl.totalIncome}
          totalLabel="Total income"
          rowHref={href}
        />
        <StatementTable
          title="Expenses"
          sections={pl.expenses}
          total={pl.totalExpenses}
          totalLabel="Total expenses"
          rowHref={href}
        />
      </div>
    </div>
  )
}

/** Balance sheet as of a date, Schedule III grouping. */
export async function BalanceSheetView({
  ctx,
  asOf,
  profitHref,
}: {
  ctx: OrgContext
  asOf: IsoDate
  /** Where "Surplus (current year)" drills down: the P&L to this date. */
  profitHref: string
}) {
  let bs
  try {
    bs = await getBalanceSheet(ctx, asOf)
  } catch (error) {
    if (!isServiceError(error)) throw error
    return <LoadError what="balance sheet" message={error.message} />
  }

  const href = (accountId: string) =>
    isAccountId(accountId) ? journalHref({ accountId, to: bs.asOf }) : null
  // Equality check only; both totals come from the service.
  const balanced = bs.totalAssets === bs.totalEquityAndLiabilities

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-secondary">
        <span>As of {formatDate(bs.asOf)}</span>
        {balanced ? (
          <StatusChip tone="success" dot>
            Balanced
          </StatusChip>
        ) : (
          <StatusChip tone="danger" dot>
            Assets and liabilities don&apos;t match
          </StatusChip>
        )}
        <span>
          · Includes this year&apos;s{" "}
          <Link href={profitHref} className="underline underline-offset-2">
            profit of <Money value={bs.currentYearProfit} />
          </Link>
        </span>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <StatementTable
          title="Equity and liabilities"
          sections={bs.equityAndLiabilities}
          total={bs.totalEquityAndLiabilities}
          totalLabel="Total equity and liabilities"
          rowHref={href}
        />
        <StatementTable
          title="Assets"
          sections={bs.assets}
          total={bs.totalAssets}
          totalLabel="Total assets"
          rowHref={href}
        />
      </div>
    </div>
  )
}
