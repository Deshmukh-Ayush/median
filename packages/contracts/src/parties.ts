import { z } from "zod"

import {
  gstStateCodeSchema,
  gstinSchema,
  isoDateSchema,
  moneySchema,
} from "./common"
import type { IsoTimestamp } from "./common"

export type PartyKind = "customer" | "vendor"

/** GST registration of a customer or vendor. */
export type PartyRegistrationType =
  "regular" | "composition" | "unregistered" | "sez" | "overseas"

export const PARTY_REGISTRATION_TYPES: readonly PartyRegistrationType[] = [
  "regular",
  "composition",
  "unregistered",
  "sez",
  "overseas",
]

/** Registration types that come with a GSTIN. */
export const REGISTRATION_TYPES_WITH_GSTIN: readonly PartyRegistrationType[] = [
  "regular",
  "composition",
  "sez",
]

/** Udyam category. Section 43B(h) covers micro and small, not medium. */
export type MsmeCategory = "micro" | "small" | "medium"

/**
 * TDS sections a vendor can default to. Rates and thresholds live in the
 * dated section master (roadmap 2.2a), not here.
 */
export const TDS_DEFAULT_SECTIONS = [
  "194C",
  "194H",
  "194I(a)",
  "194I(b)",
  "194J(a)",
  "194J(b)",
  "194Q",
] as const
export type TdsDefaultSection = (typeof TDS_DEFAULT_SECTIONS)[number]

export interface Party {
  readonly id: string
  readonly kind: PartyKind
  readonly name: string
  readonly legalName: string | null
  readonly gstin: string | null
  /** Derived from the GSTIN when there is one. */
  readonly pan: string | null
  readonly registrationType: PartyRegistrationType
  /** Two-digit GST state code. Derived from the GSTIN when one is given. */
  readonly stateCode: string | null
  readonly billingAddress: string | null
  readonly email: string | null
  readonly phone: string | null
  /** Null → the organisation's default terms. */
  readonly paymentTermsDays: number | null
  /** Vendors only. */
  readonly defaultTdsSection: TdsDefaultSection | null
  readonly msmeCategory: MsmeCategory | null
  readonly udyamNumber: string | null
  readonly archivedAt: IsoTimestamp | null
  readonly createdAt: IsoTimestamp
}

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

/** True when a GSTIN's 15th character is the right check character. */
export function gstinCheckCharOk(gstin: string): boolean {
  if (gstin.length !== 15) return false
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const value = CHARS.indexOf(gstin.charAt(i))
    if (value < 0) return false
    const product = value * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return CHARS.charAt((36 - (sum % 36)) % 36) === gstin.charAt(14)
}

/** PAN inside a GSTIN (characters 3–12). */
export function panFromGstin(gstin: string): string {
  return gstin.slice(2, 12)
}

export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Not a valid PAN")

/** A GSTIN with a valid check character (catches typos). */
export const checkedGstinSchema = gstinSchema.refine(gstinCheckCharOk, {
  message: "This GSTIN has a typo: its last character doesn't match.",
})

export const udyamNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/,
    "Udyam number looks like UDYAM-MH-01-0001234"
  )

/** Editable details of a party (kind and opening balance are set once). */
const partyDetailsShape = {
  name: z.string().trim().min(1).max(200),
  legalName: z.string().trim().min(1).max(200).nullish(),
  gstin: checkedGstinSchema.nullish(),
  pan: panSchema.nullish(),
  /** Defaults to regular with a GSTIN and unregistered without. */
  registrationType: z
    .enum(["regular", "composition", "unregistered", "sez", "overseas"])
    .optional(),
  stateCode: gstStateCodeSchema.nullish(),
  billingAddress: z.string().trim().min(1).max(500).nullish(),
  email: z.email().nullish(),
  phone: z.string().trim().max(20).nullish(),
  paymentTermsDays: z.int().min(0).max(365).nullish(),
  defaultTdsSection: z.enum(TDS_DEFAULT_SECTIONS).nullish(),
  msmeCategory: z.enum(["micro", "small", "medium"]).nullish(),
  udyamNumber: udyamNumberSchema.nullish(),
}

/** Opening balance on the day the books start. */
export const partyOpeningBalanceSchema = z.object({
  date: isoDateSchema,
  amount: moneySchema.refine((v) => v > 0n, "Amount must be more than zero"),
  /** Who owes whom: a customer usually owes us, we usually owe a vendor. */
  direction: z.enum(["owed_to_us", "owed_by_us"]),
})
export type PartyOpeningBalanceInput = z.input<typeof partyOpeningBalanceSchema>

export const createPartyInputSchema = z.object({
  kind: z.enum(["customer", "vendor"]),
  ...partyDetailsShape,
  openingBalance: partyOpeningBalanceSchema.nullish(),
})
export type CreatePartyInput = z.input<typeof createPartyInputSchema>

/** Fields left out are unchanged; null clears a field. */
export const updatePartyInputSchema = z
  .object(partyDetailsShape)
  .partial()
  .extend({ name: partyDetailsShape.name.optional() })
export type UpdatePartyInput = z.input<typeof updatePartyInputSchema>

/**
 * Fields printed on invoices and credit notes. They can't change once the
 * party has documents or ledger lines, so issued documents stay as issued.
 */
export const PARTY_LOCKED_FIELDS = [
  "name",
  "legalName",
  "gstin",
  "registrationType",
  "stateCode",
] as const satisfies readonly (keyof UpdatePartyInput)[]

export const listPartiesFiltersSchema = z.object({
  kind: z.enum(["customer", "vendor"]).optional(),
  search: z.string().trim().max(100).optional(),
  /** Archived parties are left out unless asked for. */
  includeArchived: z.boolean().optional(),
})
export type ListPartiesFilters = z.input<typeof listPartiesFiltersSchema>

export interface CreatedParty extends Party {
  /** The opening-balance journal entry, when one was given. */
  readonly openingBalanceEntryId: string | null
}

/** A party with what the edit screen needs to know. */
export interface PartyDetail extends Party {
  /** True when it has invoices, credit notes or ledger lines. */
  readonly inUse: boolean
}
