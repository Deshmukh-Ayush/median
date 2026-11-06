import type { RateBps } from "./gst"

// Effective-dated GST rates. Rates change by notification (e.g. the GST
// rate rationalisation from 22 Sep 2025), so every rate source — the HSN/SAC
// master, product/stream mappings and the org default — carries a validity
// window, and GST maths picks the rate valid on the supply date.
//
// Windows are inclusive on both ends, as notifications state them ("up to 21
// Sep 2025", "from 22 Sep 2025"). A null bound is open.

/** Calendar date, YYYY-MM-DD (IST). ISO dates compare correctly as strings. */
export type IsoDateString = string

export interface EffectiveWindow {
  /** First day the rate applies; null = since GST began. */
  readonly effectiveFrom: IsoDateString | null
  /** Last day the rate applies; null = still in force. */
  readonly effectiveTo: IsoDateString | null
}

export interface EffectiveRate extends EffectiveWindow {
  readonly rateBps: RateBps
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function assertDate(date: string, what: string): void {
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new RangeError(`${what} must be YYYY-MM-DD, got "${date}"`)
  }
}

/** Is `date` inside the window (both ends inclusive)? */
export function isEffectiveOn(
  window: EffectiveWindow,
  date: IsoDateString
): boolean {
  assertDate(date, "Supply date")
  return (
    (window.effectiveFrom === null || window.effectiveFrom <= date) &&
    (window.effectiveTo === null || date <= window.effectiveTo)
  )
}

/** Throws if a window ends before it starts. */
export function assertValidWindow(window: EffectiveWindow): void {
  if (window.effectiveFrom !== null)
    assertDate(window.effectiveFrom, "effectiveFrom")
  if (window.effectiveTo !== null) assertDate(window.effectiveTo, "effectiveTo")
  if (
    window.effectiveFrom !== null &&
    window.effectiveTo !== null &&
    window.effectiveTo < window.effectiveFrom
  ) {
    throw new RangeError("effectiveTo is before effectiveFrom")
  }
}

/** Do two windows share at least one day? */
export function windowsOverlap(
  a: EffectiveWindow,
  b: EffectiveWindow
): boolean {
  const startsBeforeEnd = (x: EffectiveWindow, y: EffectiveWindow) =>
    x.effectiveFrom === null ||
    y.effectiveTo === null ||
    x.effectiveFrom <= y.effectiveTo
  return startsBeforeEnd(a, b) && startsBeforeEnd(b, a)
}

export type RateOnResult<T extends EffectiveRate> =
  | { readonly status: "found"; readonly rate: T }
  | { readonly status: "none" }
  /** More than one rate valid that day: overlapping data, never guess. */
  | { readonly status: "ambiguous"; readonly rates: readonly T[] }

/** The single rate valid on `date`, if there is exactly one. */
export function rateOn<T extends EffectiveRate>(
  rates: readonly T[],
  date: IsoDateString
): RateOnResult<T> {
  const valid = rates.filter((r) => isEffectiveOn(r, date))
  const [only] = valid
  if (!only) return { status: "none" }
  if (valid.length > 1) {
    // Identical rates from overlapping rows agree; anything else is ambiguous.
    if (valid.every((r) => r.rateBps === only.rateBps))
      return { status: "found", rate: only }
    return { status: "ambiguous", rates: valid }
  }
  return { status: "found", rate: only }
}

/** Where a GST-inclusive amount's rate came from (rule 8). */
export type GstRateSource = "line" | "mapping" | "org_default"

export type ResolvedGstRate =
  | {
      readonly status: "found"
      readonly rateBps: RateBps
      readonly source: GstRateSource
    }
  /** Not GST-registered: no split (rule 8). */
  | { readonly status: "not_registered" }
  /** No rate valid on the supply date, or conflicting rates: inbox item. */
  | {
      readonly status: "inbox"
      readonly reason: "no_rate" | "ambiguous"
      readonly source: GstRateSource | null
    }

export interface ResolveGstRateInput {
  readonly supplyDate: IsoDateString
  readonly gstRegistered: boolean
  /** Rates on the invoice/order lines, already fixed for that document. */
  readonly lineRatesBps?: readonly RateBps[]
  /** Product or stream mapping rates (all windows for the matched key). */
  readonly mappingRates?: readonly EffectiveRate[]
  /** The org's default rate history. */
  readonly orgDefaultRates?: readonly EffectiveRate[]
}

/**
 * Rule 8: rate for a GST-inclusive amount, valid on the supply date:
 * invoice/order lines → product/stream mapping → org default → inbox.
 * Lines with mixed rates can't split one inclusive amount, so they go to
 * the inbox. A source with rows but none valid that day falls through to the
 * next source; conflicting rows stop the search (never guess).
 */
export function resolveGstRate(input: ResolveGstRateInput): ResolvedGstRate {
  assertDate(input.supplyDate, "Supply date")
  if (!input.gstRegistered) return { status: "not_registered" }

  const lines = input.lineRatesBps ?? []
  if (lines.length > 0) {
    const [first] = lines
    if (first !== undefined && lines.every((r) => r === first))
      return { status: "found", rateBps: first, source: "line" }
    return { status: "inbox", reason: "ambiguous", source: "line" }
  }

  const sources: readonly [GstRateSource, readonly EffectiveRate[]][] = [
    ["mapping", input.mappingRates ?? []],
    ["org_default", input.orgDefaultRates ?? []],
  ]
  for (const [source, rates] of sources) {
    const result = rateOn(rates, input.supplyDate)
    if (result.status === "found")
      return { status: "found", rateBps: result.rate.rateBps, source }
    if (result.status === "ambiguous")
      return { status: "inbox", reason: "ambiguous", source }
  }
  return { status: "inbox", reason: "no_rate", source: null }
}
