// Credit notes against sales invoices (rule 10: refunds of invoiced sales).
// A credit note follows its invoice's GST treatment; amounts are computed by
// @workspace/ledger, never sent by the client.

import type { Money } from "@workspace/ledger"
import { z } from "zod"

import { idSchema, isoDateSchema, moneySchema } from "./common"
import type { IsoDate, IsoTimestamp, PartyRef } from "./common"
import type { InvoiceSupplyType } from "./invoices"

export const CREDIT_NOTE_REASONS = [
  "refund",
  "sales_return",
  "post_sale_discount",
  "deficiency_in_service",
  "correction",
] as const
export type CreditNoteReason = (typeof CREDIT_NOTE_REASONS)[number]

export interface CreditNoteLine {
  readonly id: string
  /** The invoice line credited. */
  readonly invoiceLineId: string | null
  readonly description: string
  readonly hsnSac: string
  readonly quantity: string
  readonly unitPrice: Money
  readonly gstRateBps: number
  readonly taxable: Money
  readonly cgst: Money
  readonly sgst: Money
  readonly igst: Money
  readonly total: Money
}

export interface CreditNote {
  readonly id: string
  /** e.g. "CN/2026-27/0003" (at most 16 characters, rule 5). */
  readonly number: string
  readonly financialYear: string
  readonly invoice: { readonly id: string; readonly number: string }
  readonly party: PartyRef
  readonly creditNoteDate: IsoDate
  readonly reason: CreditNoteReason
  /** Copied from the invoice. */
  readonly placeOfSupply: string
  readonly supplyType: InvoiceSupplyType
  readonly reverseCharge: boolean
  readonly lines: readonly CreditNoteLine[]
  readonly taxable: Money
  readonly cgst: Money
  readonly sgst: Money
  readonly igst: Money
  readonly roundOff: Money
  readonly total: Money
  /** The Razorpay refund that caused it, if any. */
  readonly sourceRecordId: string | null
  readonly notes: string | null
  readonly journalEntryId: string | null
  readonly createdAt: IsoTimestamp
}

/**
 * Each line credits one invoice line: either a quantity returned (at the
 * invoice's unit price) or a taxable value (a discount or correction).
 */
const creditNoteLineInputSchema = z.union([
  z.object({
    invoiceLineId: idSchema,
    quantity: z
      .string()
      .trim()
      .regex(/^\d{1,9}(\.\d{1,3})?$/, "Quantity like 1 or 7.5")
      .refine((q) => !/^0+(\.0+)?$/.test(q), "Quantity must be more than zero"),
  }),
  z.object({
    invoiceLineId: idSchema,
    taxable: moneySchema.refine((v) => v > 0n, "Amount must be more than zero"),
  }),
])

export const createCreditNoteInputSchema = z.object({
  invoiceId: idSchema,
  creditNoteDate: isoDateSchema,
  reason: z.enum(CREDIT_NOTE_REASONS),
  notes: z.string().trim().max(2000).nullish(),
  lines: z.array(creditNoteLineInputSchema).min(1).max(100),
})
export type CreateCreditNoteInput = z.input<typeof createCreditNoteInputSchema>
