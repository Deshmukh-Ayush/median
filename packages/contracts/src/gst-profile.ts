import { z } from "zod"

import {
  gstStateCodeSchema,
  gstinSchema,
  idSchema,
  isoDateSchema,
} from "./common"
import { isActiveGstStateCode } from "./gst-states"

export interface GstProfile {
  readonly legalName: string | null
  readonly gstin: string | null
  /** Two-digit GST state code. */
  readonly stateCode: string | null
  readonly gstRegistered: boolean
  readonly compositionScheme: boolean
  /** Basis points (18% = 1800). Null: unmapped sales go to the inbox. */
  readonly defaultGstRateBps: number | null
}

export const rateBpsSchema = z.int().min(0).max(10_000)

export const updateGstProfileInputSchema = z
  .object({
    legalName: z.string().trim().min(1).max(200).nullable(),
    gstin: gstinSchema.nullable(),
    stateCode: gstStateCodeSchema
      .refine(isActiveGstStateCode, "Not a GST state code")
      .nullable(),
    gstRegistered: z.boolean(),
    compositionScheme: z.boolean(),
    defaultGstRateBps: rateBpsSchema.nullable(),
  })
  .refine((p) => !p.gstRegistered || p.gstin !== null, {
    message: "A GST-registered business needs its GSTIN.",
    path: ["gstin"],
  })
  .refine((p) => !p.compositionScheme || p.gstRegistered, {
    message: "The composition scheme needs GST registration.",
    path: ["compositionScheme"],
  })
  .refine(
    (p) =>
      p.gstin === null ||
      p.stateCode === null ||
      p.gstin.startsWith(p.stateCode),
    { message: "State code doesn't match the GSTIN.", path: ["stateCode"] }
  )
export type UpdateGstProfileInput = z.input<typeof updateGstProfileInputSchema>

export type GstRateMappingKind = "product" | "stream"

export interface GstRateMapping {
  readonly id: string
  readonly kind: GstRateMappingKind
  /** Razorpay item/plan id for products; a stream name for streams. */
  readonly key: string
  readonly label: string
  readonly hsnSac: string | null
  readonly gstRateBps: number
  /** Null → the org's default revenue account. */
  readonly revenueAccountId: string | null
  /** First day this rate applies (inclusive); null = since GST began. */
  readonly effectiveFrom: string | null
  /** Last day this rate applies (inclusive); null = still in force. */
  readonly effectiveTo: string | null
}

export const upsertGstRateMappingInputSchema = z.object({
  kind: z.enum(["product", "stream"]),
  key: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  hsnSac: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "HSN/SAC is 4–8 digits")
    .nullable(),
  gstRateBps: rateBpsSchema,
  revenueAccountId: idSchema.nullable(),
  /**
   * Rate change from this date (YYYY-MM-DD): the window in force the day
   * before ends then, so earlier payments keep the old rate. Omit to edit the
   * undated mapping of a key that has never changed rate.
   */
  effectiveFrom: isoDateSchema.nullable().default(null),
})
export type UpsertGstRateMappingInput = z.input<
  typeof upsertGstRateMappingInputSchema
>

export const listMappingsFiltersSchema = z.object({
  kind: z.enum(["product", "stream"]).optional(),
})
