import { periodSchema } from "@workspace/contracts"
import type { IsoDate, Period } from "@workspace/contracts"

import type { ParamValue } from "./report-params"
import { firstParam } from "./report-params"

export interface GstDeadline {
  /** "GSTR-1", "GSTR-3B", "CMP-08", "GSTR-4" */
  readonly form: string
  readonly description: string
  readonly due: IsoDate
}

const pad = (n: number) => String(n).padStart(2, "0")

/** "2026-10" plus `months` → "2026-11". */
export function addMonths(period: Period, months: number): Period {
  const y = Number(period.slice(0, 4))
  const m = Number(period.slice(5, 7)) - 1 + months
  const year = y + Math.floor(m / 12)
  return `${year}-${pad((((m % 12) + 12) % 12) + 1)}`
}

/** The month a date falls in, "2026-11-10" → "2026-11". */
export const periodOfDate = (date: IsoDate): Period => date.slice(0, 7)

/**
 * Filing deadlines for one month's returns, by the standard due dates:
 * monthly filers GSTR-1 on the 11th and GSTR-3B on the 20th of the next
 * month; composition dealers CMP-08 on the 18th after each quarter and
 * GSTR-4 on 30 April after the financial year. QRMP dates and government
 * extensions aren't included.
 */
export function gstDeadlines(
  period: Period,
  profile: {
    readonly gstRegistered: boolean
    readonly compositionScheme: boolean
  }
): readonly GstDeadline[] {
  if (!profile.gstRegistered) return []
  const next = addMonths(period, 1)
  if (!profile.compositionScheme) {
    return [
      {
        form: "GSTR-1",
        description: "Sales (outward supplies) for the month",
        due: `${next}-11`,
      },
      {
        form: "GSTR-3B",
        description: "Summary return and tax payment",
        due: `${next}-20`,
      },
    ]
  }
  const month = Number(period.slice(5, 7))
  // Quarters end in June, September, December and March.
  const quarterEnd = addMonths(period, (3 - (month % 3)) % 3)
  const deadlines: GstDeadline[] = [
    {
      form: "CMP-08",
      description: "Quarterly statement and tax payment (composition)",
      due: `${addMonths(quarterEnd, 1)}-18`,
    },
  ]
  if (month <= 3) {
    deadlines.push({
      form: "GSTR-4",
      description: "Annual return (composition)",
      due: `${period.slice(0, 4)}-04-30`,
    })
  }
  return deadlines
}

/** Whole days from `today` to `due` (negative once it has passed). */
export function daysUntil(today: IsoDate, due: IsoDate): number {
  const ms = Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/** A YYYY-MM search param, or undefined. */
export function periodParam(value: ParamValue): Period | undefined {
  const parsed = periodSchema.safeParse(firstParam(value))
  return parsed.success ? parsed.data : undefined
}
