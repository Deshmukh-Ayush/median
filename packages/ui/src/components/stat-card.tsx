import * as React from "react"
import { cn } from "cn"
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react"
import { paise } from "@workspace/ledger"
import type { Money as MoneyValue } from "@workspace/ledger"

import { Money } from "@workspace/ui/components/money"
import { Skeleton } from "@workspace/ui/components/skeleton"

interface StatChange {
  /** Difference vs the previous period, from the service. */
  amount: MoneyValue
  /** Percentage change, from the service. The UI doesn't compute it. */
  percent?: number
  /** "vs last month". */
  period: string
}

type StatCardProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Founder language: "Money in", "Owed to you", "Tax due". */
  label: string
  value?: MoneyValue
  change?: StatChange
  /** Where the number clicks through to (the entries behind it). */
  href?: string
  compact?: boolean
  /** `danger` only for a real problem, like negative cash. */
  tone?: "default" | "danger"
  loading?: boolean
  /** Shown instead of the value when it couldn't be loaded. */
  error?: string
}

function formatPercent(percent: number): string {
  return `${Math.abs(percent).toFixed(1)}%`
}

function ChangeLine({ change }: { change: StatChange }) {
  const direction =
    change.amount > 0n ? "up" : change.amount < 0n ? "down" : "flat"
  const Icon =
    direction === "up"
      ? ArrowUpRightIcon
      : direction === "down"
        ? ArrowDownRightIcon
        : MinusIcon
  const word =
    direction === "up" ? "Up" : direction === "down" ? "Down" : "No change"
  const raw: bigint = change.amount
  const abs = paise(raw < 0n ? -raw : raw)
  return (
    <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-fg-secondary">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="sr-only">{word}</span>
      {direction === "flat" ? null : (
        <Money value={abs} compact className="text-fg-secondary" />
      )}
      {change.percent === undefined || direction === "flat" ? null : (
        <span>({formatPercent(change.percent)})</span>
      )}
      <span className="whitespace-nowrap">{change.period}</span>
    </p>
  )
}

/** A headline number with its label and change vs last period. */
function StatCard({
  label,
  value,
  change,
  href,
  compact = false,
  tone = "default",
  loading = false,
  error,
  className,
  ...props
}: StatCardProps) {
  const body = (
    <>
      <p className="text-xs font-medium text-fg-secondary">{label}</p>
      {loading ? (
        <div className="flex flex-col gap-2 pt-1">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      ) : error ? (
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold text-fg-disabled">—</p>
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {value === undefined ? (
            <p className="text-lg font-semibold text-fg-disabled">—</p>
          ) : (
            <Money
              value={value}
              compact={compact}
              tone={tone}
              className="text-lg leading-7 font-semibold"
            />
          )}
          {change ? <ChangeLine change={change} /> : null}
        </div>
      )}
    </>
  )
  const shared = cn(
    "flex min-h-24 flex-col gap-2 rounded-lg border border-default bg-surface p-4",
    className
  )
  if (href && !loading) {
    return (
      <a
        data-slot="stat-card"
        href={href}
        className={cn(
          shared,
          "transition-colors hover:border-input active:bg-app"
        )}
        {...(props as React.ComponentProps<"a">)}
      >
        {body}
      </a>
    )
  }
  return (
    <div
      data-slot="stat-card"
      aria-busy={loading || undefined}
      className={shared}
      {...props}
    >
      {body}
    </div>
  )
}

export { StatCard }
export type { StatCardProps, StatChange }
