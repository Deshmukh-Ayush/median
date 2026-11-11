import * as React from "react"
import { cn } from "cn"
import type { Money as MoneyValue } from "@workspace/contracts"

import { formatMoney } from "@workspace/ui/lib/format-money"

type MoneyProps = Omit<React.ComponentProps<"data">, "value" | "children"> & {
  /** Integer paise. */
  value: MoneyValue
  /**
   * Lakh/crore form from 1 lakh up (₹1.5 L), rounded to the rupee below that.
   * For headline numbers (StatCard, dashboard). The exact amount stays in the
   * tooltip and for screen readers.
   */
  compact?: boolean
  /**
   * Round to the nearest rupee (₹1,23,457). Default false: exact paise
   * (₹1,23,456.78), which is what tables and ledgers should show.
   */
  roundToRupee?: boolean
  /** `ledger` puts negatives in brackets for CA views. */
  variant?: "default" | "ledger"
  /**
   * `danger` only for real problems (overdue, negative cash). Don't colour
   * every negative number.
   */
  tone?: "default" | "danger"
}

/** An amount of money: exact by default (₹1,23,456.78), tabular figures, true minus sign. */
function Money({
  value,
  compact = false,
  roundToRupee = false,
  variant = "default",
  tone = "default",
  className,
  ...props
}: MoneyProps) {
  const ledger = variant === "ledger"
  const exact = formatMoney(value, { ledger })
  const shown = formatMoney(value, { compact, roundToRupee, ledger })
  const isCompacted = shown !== exact
  const full = exact
  return (
    <data
      data-slot="money"
      data-tone={tone}
      value={value.toString()}
      title={isCompacted ? full : undefined}
      className={cn(
        "tabular whitespace-nowrap text-fg data-[tone=danger]:text-danger",
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
