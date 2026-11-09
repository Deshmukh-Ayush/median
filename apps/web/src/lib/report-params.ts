import { idSchema, isoDateSchema } from "@workspace/contracts"
import type { IsoDate, JournalSourceType } from "@workspace/contracts"

/** One value of a search param (the first, if it was repeated). */
export type ParamValue = string | string[] | undefined

export function firstParam(value: ParamValue): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  const trimmed = v?.trim()
  return trimmed ? trimmed : undefined
}

/** A YYYY-MM-DD search param, or undefined if it's missing or invalid. */
export function dateParam(value: ParamValue): IsoDate | undefined {
  const parsed = isoDateSchema.safeParse(firstParam(value))
  return parsed.success ? parsed.data : undefined
}

/** A UUID search param, or undefined if it's missing or invalid. */
export function idParam(value: ParamValue): string | undefined {
  const parsed = idSchema.safeParse(firstParam(value))
  return parsed.success ? parsed.data : undefined
}

/** First day of the Indian financial year (1 April) that contains `date`. */
export function financialYearStart(date: IsoDate): IsoDate {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  return `${month >= 4 ? year : year - 1}-04-01`
}

export const SOURCE_LABELS: Record<JournalSourceType, string> = {
  manual: "Manual",
  razorpay: "Razorpay",
  bank: "Bank",
  invoice: "Invoice",
  bill: "Bill",
  inbox: "AI inbox",
  reversal: "Reversal",
  opening_balance: "Opening balance",
  credit_note: "Credit note",
}

export const JOURNAL_SOURCES = [
  "manual",
  "razorpay",
  "bank",
  "invoice",
  "bill",
  "inbox",
  "reversal",
  "opening_balance",
  "credit_note",
] as const satisfies readonly JournalSourceType[]

export function sourceParam(value: ParamValue): JournalSourceType | undefined {
  const v = firstParam(value)
  return JOURNAL_SOURCES.find((s) => s === v)
}

export interface JournalLink {
  readonly accountId?: string | undefined
  readonly from?: IsoDate | undefined
  readonly to?: IsoDate | undefined
  readonly source?: JournalSourceType | undefined
  readonly q?: string | undefined
  readonly cursor?: string | undefined
}

/** `/ledger` journal URL with the given filters; every report drills down here. */
export function journalHref(link: JournalLink = {}): string {
  const params = new URLSearchParams()
  if (link.accountId) params.set("account", link.accountId)
  if (link.from) params.set("from", link.from)
  if (link.to) params.set("to", link.to)
  if (link.source) params.set("source", link.source)
  if (link.q) params.set("q", link.q)
  if (link.cursor) params.set("cursor", link.cursor)
  const query = params.toString()
  return query ? `/ledger?${query}` : "/ledger"
}

export function trialBalanceHref(asOf?: IsoDate): string {
  return asOf
    ? `/ledger?view=trial-balance&asOf=${asOf}`
    : "/ledger?view=trial-balance"
}
