// Bank statement lines. CSV imports (parsed server-side) and PDF statements
// (AI module) both produce BankRow; the bank-statement connector turns rows
// into bank_line SourceRecords, deduped per rule 12.

import { parseRupees } from "@workspace/ledger"
import { z } from "zod"

import { isoDateSchema } from "./common"

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
 * One normalised bank statement line. Amounts are rupee text as printed;
 * exactly one of `debit` / `credit` is set.
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

export type BankMatchKind =
  "razorpay_settlement" | "invoice_payment" | "known_vendor"

/** A bank line booked by a deterministic match. */
export interface BankLineMatched {
  readonly rowIndex: number
  readonly sourceRecordId: string
  readonly matchKind: BankMatchKind
  readonly entryId: string
}

/** A bank line sent to the inbox. */
export interface BankLineUnmatched {
  readonly rowIndex: number
  readonly sourceRecordId: string
  readonly inboxItemId: string
}
