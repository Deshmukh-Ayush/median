// Shared primitives for every contract: dates, money, pages, ledger shapes.
//
// Conventions:
// - Money is `Money` (integer paise, bigint). Format with `formatInr` from
//   @workspace/ledger; parse user input with `parseRupees`.
// - Calendar dates are ISO strings (YYYY-MM-DD); timestamps are ISO strings.
// - Lists return `Page<T>`; pass `nextCursor` back to get the next page.

import { paise } from "@workspace/ledger"
import type { Money } from "@workspace/ledger"
import { z } from "zod"

import { ServiceError } from "./errors"

export type { Money }

/** YYYY-MM-DD */
export type IsoDate = string
/** ISO 8601 timestamp */
export type IsoTimestamp = string
/** YYYY-MM */
export type Period = string

export const isoDateSchema = z.iso.date()
export const periodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must be YYYY-MM")
export const idSchema = z.uuid()
export const gstStateCodeSchema = z
  .string()
  .regex(/^\d{2}$/, "GST state code is two digits, e.g. 29")
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Not a valid GSTIN")

/** Money arriving as a bigint (server-to-server). */
export const moneySchema = z.bigint().transform((v) => paise(v))
/** Money stored in JSON as an integer-paise string ("118000"). */
export const moneyJsonSchema = z
  .string()
  .regex(/^-?\d+$/, "Amount must be integer paise")
  .transform((v) => paise(BigInt(v)))

export interface Page<T> {
  readonly items: readonly T[]
  /** Null when there are no more pages. */
  readonly nextCursor: string | null
}

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

export const pageOptionsSchema = z.object({
  limit: z.int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})
export type PageOptions = z.input<typeof pageOptionsSchema>

/**
 * Keyset cursor: the sort key and id of the last row on the page. Encoding
 * is server-side (apps/web/src/server/services/pagination.ts).
 */
export const cursorSchema = z.object({ k: z.string(), id: z.string() })
export type Cursor = z.infer<typeof cursorSchema>

/** Parses service input with Zod, turning failures into ServiceError. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown
): z.output<S> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new ServiceError(
      "VALIDATION",
      result.error.issues[0]?.message ?? "Invalid input.",
      z.flattenError(result.error)
    )
  }
  return result.data
}

// ---------------------------------------------------------------------------
// Ledger shapes shared by several services

export type AccountType =
  "asset" | "liability" | "equity" | "income" | "expense"

export interface LedgerAccountSummary {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly type: AccountType
  readonly parentId: string | null
  readonly isSystem: boolean
}

export interface PartyRef {
  readonly id: string
  readonly name: string
  readonly gstin: string | null
}

export type JournalSourceType =
  | "manual"
  | "razorpay"
  | "bank"
  | "invoice"
  | "bill"
  | "inbox"
  | "reversal"
  | "opening_balance"

export interface JournalLineView {
  readonly id: string
  readonly account: Pick<LedgerAccountSummary, "id" | "code" | "name" | "type">
  readonly party: PartyRef | null
  readonly debit: Money
  readonly credit: Money
  readonly description: string | null
}

export interface JournalEntryView {
  readonly id: string
  readonly entryDate: IsoDate
  readonly narration: string
  readonly sourceType: JournalSourceType
  readonly sourceId: string | null
  readonly reversesEntryId: string | null
  readonly reversedByEntryId: string | null
  readonly lines: readonly JournalLineView[]
  /** Sum of debits (= sum of credits). */
  readonly total: Money
  readonly createdBy: string | null
  readonly createdAt: IsoTimestamp
}
