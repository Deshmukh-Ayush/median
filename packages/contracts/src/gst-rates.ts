// Effective-dated GST rates: the standard slab list, the HSN/SAC master and
// rate windows on product/stream mappings and the org default rate.
//
// Windows are inclusive on both ends; a null bound is open (see
// @workspace/ledger gst-rates.ts). Rates are basis points (18% = 1800).
// Rates here are never invented: the HSN/SAC master starts empty and is
// filled only from official notifications by the import script.

import { z } from "zod"

import { isoDateSchema } from "./common"
import type { IsoDate } from "./common"

/** A GST rate in basis points, 0–100%. */
export const gstRateBpsSchema = z.int().min(0).max(10_000)

/** Inclusive validity window; null = open-ended. */
export const effectiveWindowSchema = z
  .object({
    effectiveFrom: isoDateSchema.nullable(),
    effectiveTo: isoDateSchema.nullable(),
  })
  .refine(
    (w) =>
      w.effectiveFrom === null ||
      w.effectiveTo === null ||
      w.effectiveFrom <= w.effectiveTo,
    {
      message: "effectiveTo can't be before effectiveFrom",
      path: ["effectiveTo"],
    }
  )
export type EffectiveWindowInput = z.input<typeof effectiveWindowSchema>

// ---------------------------------------------------------------------------
// Standard slabs

export interface GstSlabPeriod {
  readonly effectiveFrom: IsoDate | null
  readonly effectiveTo: IsoDate | null
  /** Standard GST slabs in basis points, ascending. */
  readonly slabsBps: readonly number[]
}

/** First day of the rationalised slabs (GST Council, 56th meeting). */
export const GST_SLABS_REVISED_FROM: IsoDate = "2025-09-22"

/**
 * Standard GST slabs by period: 0, 5, 12, 18, 28% until 21 Sep 2025; 0, 5,
 * 18, 40% from 22 Sep 2025. Special rates outside the slabs (e.g. 0.25% on
 * rough diamonds, 3% on gold) exist, so a rate off the list is a warning for
 * review, not an error.
 */
export const GST_SLAB_PERIODS: readonly GstSlabPeriod[] = [
  {
    effectiveFrom: null,
    effectiveTo: "2025-09-21",
    slabsBps: [0, 500, 1200, 1800, 2800],
  },
  {
    effectiveFrom: GST_SLABS_REVISED_FROM,
    effectiveTo: null,
    slabsBps: [0, 500, 1800, 4000],
  },
]

/** The standard slabs in force on a supply date (YYYY-MM-DD). */
export function gstSlabsOn(date: IsoDate): readonly number[] {
  const period = GST_SLAB_PERIODS.find(
    (p) =>
      (p.effectiveFrom === null || p.effectiveFrom <= date) &&
      (p.effectiveTo === null || date <= p.effectiveTo)
  )
  return period?.slabsBps ?? []
}

/** Is `rateBps` a standard slab on `date`? */
export function isStandardGstSlab(rateBps: number, date: IsoDate): boolean {
  return gstSlabsOn(date).includes(rateBps)
}

// ---------------------------------------------------------------------------
// HSN/SAC master

/** HSN (goods) is 2, 4, 6 or 8 digits; SAC (services) is 6 digits from 99. */
export const hsnSacCodeSchema = z
  .string()
  .trim()
  .regex(/^(\d{2}|\d{4}|\d{6}|\d{8})$/, "HSN/SAC is 2, 4, 6 or 8 digits")

export type HsnSacKind = "hsn" | "sac"

/** SAC codes are the 99 chapter. */
export function hsnSacKindOf(code: string): HsnSacKind {
  return code.startsWith("99") ? "sac" : "hsn"
}

/**
 * One row of the HSN/SAC rate import file (CSV columns in this order):
 * code, description, rate_bps, effective_from, effective_to, condition,
 * source. `source` cites the notification the rate comes from.
 */
export const hsnSacRateImportRowSchema = z
  .object({
    code: hsnSacCodeSchema,
    description: z.string().trim().min(1).max(1000),
    rateBps: gstRateBpsSchema,
    effectiveFrom: isoDateSchema,
    effectiveTo: isoDateSchema.nullable(),
    /** e.g. "sale value per piece up to ₹2,500"; null if unconditional. */
    condition: z.string().trim().min(1).max(500).nullable(),
    source: z.string().trim().min(1).max(500),
  })
  .refine((r) => r.effectiveTo === null || r.effectiveFrom <= r.effectiveTo, {
    message: "effective_to can't be before effective_from",
    path: ["effectiveTo"],
  })
export type HsnSacRateImportRow = z.output<typeof hsnSacRateImportRowSchema>

export interface HsnSacRate {
  /** The master code the rate is defined on (may be a parent heading). */
  readonly code: string
  readonly rateBps: number
  readonly effectiveFrom: IsoDate
  readonly effectiveTo: IsoDate | null
  readonly condition: string | null
  readonly source: string
}

export const lookupHsnSacRateInputSchema = z.object({
  code: hsnSacCodeSchema,
  /** Supply date, YYYY-MM-DD. */
  onDate: isoDateSchema,
})
export type LookupHsnSacRateInput = z.input<typeof lookupHsnSacRateInputSchema>

export type HsnSacRateLookup =
  | {
      readonly status: "found"
      readonly code: string
      readonly kind: HsnSacKind
      readonly description: string
      readonly rate: HsnSacRate
    }
  /**
   * Several rates apply that day (e.g. price-conditional rates); the user
   * picks one. Never guessed.
   */
  | {
      readonly status: "conditional"
      readonly code: string
      readonly kind: HsnSacKind
      readonly description: string
      readonly rates: readonly HsnSacRate[]
    }
  /** Code (or a parent heading) is in the master but has no rate that day. */
  | { readonly status: "no_rate"; readonly code: string }
  /** Code isn't in the master. */
  | { readonly status: "unknown_code"; readonly code: string }

// ---------------------------------------------------------------------------
// Effective-dated rate for GST-inclusive amounts (rule 8)

export const findGstRateInputSchema = z.object({
  /** Supply date, YYYY-MM-DD. */
  supplyDate: isoDateSchema,
  /** Rates on the invoice/order lines, if there is a document. */
  lineRatesBps: z.array(gstRateBpsSchema).max(1000).optional(),
  /** Product or stream mapping key the payment carries. */
  mapping: z
    .object({
      kind: z.enum(["product", "stream"]),
      key: z.string().trim().min(1).max(200),
    })
    .optional(),
})
export type FindGstRateInput = z.input<typeof findGstRateInputSchema>

export type GstRateSource = "line" | "mapping" | "org_default"

export type FindGstRateResult =
  | {
      readonly status: "found"
      readonly rateBps: number
      readonly source: GstRateSource
      /** Off the standard slabs for the supply date: show for review. */
      readonly warning: string | null
    }
  | { readonly status: "not_registered" }
  | {
      readonly status: "inbox"
      readonly reason: "no_rate" | "ambiguous"
      readonly source: GstRateSource | null
    }

/** A dated org default rate. */
export const setOrgDefaultGstRateInputSchema = z.object({
  rateBps: gstRateBpsSchema,
  /** First day the new default applies; the previous one ends the day before. */
  effectiveFrom: isoDateSchema,
})
export type SetOrgDefaultGstRateInput = z.input<
  typeof setOrgDefaultGstRateInputSchema
>

export interface OrgDefaultGstRate {
  readonly rateBps: number
  readonly effectiveFrom: IsoDate | null
  readonly effectiveTo: IsoDate | null
}
