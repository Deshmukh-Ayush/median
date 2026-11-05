import "server-only"

import { parseRupees } from "@workspace/ledger"
import { z } from "zod"

import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { idSchema, isoDateSchema, parseInput } from "./types"

const amountText = z
  .string()
  .trim()
  .refine((v) => {
    try {
      parseRupees(v)
      return true
    } catch {
      return false
    }
  }, "Not a rupee amount")

/**
 * One normalised bank statement line. CSV imports (papaparse, server-side)
 * and PDF statements (AI module) both produce this shape. Amounts are rupee
 * text as printed; exactly one of `debit` / `credit` is set.
 */
export const bankRowSchema = z
  .object({
    date: isoDateSchema,
    description: z.string().trim().min(1).max(500),
    reference: z.string().trim().max(200).nullable(),
    debit: amountText.nullable(),
    credit: amountText.nullable(),
    balance: amountText.nullable(),
  })
  .refine(
    (r) => (r.debit === null) !== (r.credit === null),
    "Set exactly one of debit or credit"
  )
export type BankRow = z.input<typeof bankRowSchema>

export const importBankRowsOptionsSchema = z.object({
  /** The bank ledger account (asset) these lines belong to. */
  bankAccountId: idSchema,
})
export type ImportBankRowsOptions = z.input<typeof importBankRowsOptionsSchema>

export type BankMatchKind =
  "razorpay_settlement" | "invoice_payment" | "known_vendor"

export interface BankImportResult {
  readonly imported: number
  /** Rows already imported before (same date, amount, reference, balance). */
  readonly duplicates: number
  readonly matched: readonly {
    readonly rowIndex: number
    readonly sourceRecordId: string
    readonly matchKind: BankMatchKind
    readonly entryId: string
  }[]
  readonly unmatched: readonly {
    readonly rowIndex: number
    readonly sourceRecordId: string
    readonly inboxItemId: string
  }[]
  readonly errors: readonly {
    readonly rowIndex: number
    readonly message: string
  }[]
}

/**
 * Imports bank lines, matches them deterministically and sends the rest to
 * the inbox. Invalid rows are reported in `errors`, not thrown. Safe to
 * re-import the same statement. STUB.
 */
export async function importBankRows(
  ctx: OrgContext,
  rows: readonly unknown[],
  options: ImportBankRowsOptions
): Promise<BankImportResult> {
  assertCan(ctx, "ledger", "post")
  parseInput(importBankRowsOptionsSchema, options)
  const errors: { rowIndex: number; message: string }[] = []
  const matched: BankImportResult["matched"][number][] = []
  const unmatched: BankImportResult["unmatched"][number][] = []
  rows.forEach((row, rowIndex) => {
    const parsed = bankRowSchema.safeParse(row)
    if (!parsed.success) {
      errors.push({
        rowIndex,
        message: parsed.error.issues[0]?.message ?? "Invalid row",
      })
    } else if (parsed.data.credit !== null && rowIndex % 3 !== 2) {
      matched.push({
        rowIndex,
        sourceRecordId: crypto.randomUUID(),
        matchKind: "razorpay_settlement",
        entryId: crypto.randomUUID(),
      })
    } else {
      unmatched.push({
        rowIndex,
        sourceRecordId: crypto.randomUUID(),
        inboxItemId: crypto.randomUUID(),
      })
    }
  })
  await Promise.resolve()
  return {
    imported: matched.length + unmatched.length,
    duplicates: 0,
    matched,
    unmatched,
    errors,
  }
}
