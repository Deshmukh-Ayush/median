import * as React from "react"
import { cn } from "cn"
import type { Money as MoneyValue } from "@workspace/ledger"

import { formatMoney } from "@workspace/ui/lib/format-money"

type MoneyProps = Omit<React.ComponentProps<"data">, "value" | "children"> & {
  /** Integer paise. */
  value: MoneyValue
  /** Lakh/crore form from 1 lakh up (₹1.5 L). The full amount stays available. */
  compact?: boolean
  /** Show paise. Default false (rounded to the rupee, display only). */
  paise?: boolean
  /** `ledger` puts negatives in brackets for CA views. */
  variant?: "default" | "ledger"
  /**
   * `danger` only for real problems (overdue, negative cash). Don't colour
   * every negative number.
   */
  tone?: "default" | "danger"
}

/** An amount of money: ₹1,23,45,678, tabular figures, true minus sign. */
function Money({
  value,
  compact = false,
  paise = false,
  variant = "default",
  tone = "default",
  className,
  ...props
}: MoneyProps) {
  const ledger = variant === "ledger"
  const full = formatMoney(value, { paise, ledger })
  const shown = compact ? formatMoney(value, { compact, paise, ledger }) : full
  const isCompacted = shown !== full
  return (
    <data
      data-slot="money"
      data-tone={tone}
      value={value.toString()}
      title={isCompacted ? full : undefined}
      className={cn(
        "whitespace-nowrap text-fg tabular data-[tone=danger]:text-danger",
        className
      )}
      {...props}
    >
      {isCompacted ? (
        <>
          <span aria-hidden>{shown}</span>
          <span className="sr-only">{full}</span>
        </>
      ) : (
        shown
      )}
    </data>
  )
}

export { Money }
export type { MoneyProps }
