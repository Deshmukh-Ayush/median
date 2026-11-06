import { z } from "zod"

import { gstStateCodeSchema, gstinSchema } from "./common"
import type { IsoTimestamp } from "./common"

export type PartyKind = "customer" | "vendor"

export interface Party {
  readonly id: string
  readonly kind: PartyKind
  readonly name: string
  readonly gstin: string | null
  /** Two-digit GST state code. Derived from the GSTIN when one is given. */
  readonly stateCode: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly createdAt: IsoTimestamp
}

export const createPartyInputSchema = z.object({
  kind: z.enum(["customer", "vendor"]),
  name: z.string().trim().min(1).max(200),
  gstin: gstinSchema.nullish(),
  stateCode: gstStateCodeSchema.nullish(),
  email: z.email().nullish(),
  phone: z.string().trim().max(20).nullish(),
})
export type CreatePartyInput = z.input<typeof createPartyInputSchema>

export const listPartiesFiltersSchema = z.object({
  kind: z.enum(["customer", "vendor"]).optional(),
  search: z.string().trim().max(100).optional(),
})
export type ListPartiesFilters = z.input<typeof listPartiesFiltersSchema>
