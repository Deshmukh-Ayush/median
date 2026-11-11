// Bills (payables): vendor bills, payments against them, vendor advances and
// a party's statement of account. Amounts are computed in code.

import { z } from "zod"

import { idSchema, isoDateSchema, moneySchema } from "./common"
import type { IsoDate, IsoTimestamp, Money, PartyRef } from "./common"

export type BillStatus = "open" | "partially_paid" | "paid"

export interface Bill {
  readonly id: string
  readonly party: PartyRef
  /** The vendor's own bill number. */
  readonly number: string
  readonly billDate: IsoDate
  readonly dueDate: IsoDate
  /** Owed to the vendor (after any TDS deducted on the bill). */
  readonly total: Money
  /** Paid or adjusted from advances. */
  readonly settled: Money
  readonly outstanding: Money
  readonly status: BillStatus
  readonly journalEntryId: string
  readonly documentId: string | null
  readonly createdAt: IsoTimestamp
}

export const listBillsFiltersSchema = z.object({
  partyId: idSchema.optional(),
  /** "open" = anything still owed (the default), "all" includes paid bills. */
  status: z.enum(["open", "all"]).optional(),
})
export type ListBillsFilters = z.input<typeof listBillsFiltersSchema>

const positiveMoney = moneySchema.refine((v) => v > 0n, {
  message: "Amount must be more than zero",
})

export const recordBillPaymentInputSchema = z.object({
  billId: idSchema,
  /** A bank (or cash) ledger account the money left from. */
  bankAccountId: idSchema,
  date: isoDateSchema,
  amount: positiveMoney,
  /** UTR, cheque number… shown in the narration. */
  reference: z.string().trim().max(100).nullish(),
})
export type RecordBillPaymentInput = z.input<
  typeof recordBillPaymentInputSchema
>

export const recordVendorAdvanceInputSchema = z.object({
  partyId: idSchema,
  bankAccountId: idSchema,
  date: isoDateSchema,
  amount: positiveMoney,
  reference: z.string().trim().max(100).nullish(),
})
export type RecordVendorAdvanceInput = z.input<
  typeof recordVendorAdvanceInputSchema
>

export const adjustVendorAdvanceInputSchema = z.object({
  billId: idSchema,
  date: isoDateSchema,
  amount: positiveMoney,
})
export type AdjustVendorAdvanceInput = z.input<
  typeof adjustVendorAdvanceInputSchema
>

/**
 * Outstanding payables by days since the bill date. The 45-day line is
 * where section 43B(h) starts to bite for micro and small vendors.
 */
export interface PayablesBuckets {
  readonly days0To30: Money
  readonly days31To45: Money
  readonly days46To60: Money
  readonly days61To90: Money
  readonly over90: Money
  readonly total: Money
}

export interface PartyPayables extends PayablesBuckets {
  readonly party: PartyRef
  readonly openBills: number
  readonly msmeCategory: "micro" | "small" | "medium" | null
}

export interface PayablesAgeing {
  /** Today in India (IST); ages are counted to this date. */
  readonly asOf: IsoDate
  /** Across every vendor, not just this page. */
  readonly totals: PayablesBuckets
  /** Owed to micro and small vendors on bills more than 45 days old. */
  readonly msmeOver45Days: Money
  /** Vendors with something outstanding, by name. */
  readonly parties: {
    readonly items: readonly PartyPayables[]
    readonly nextCursor: string | null
  }
}

export const partyStatementInputSchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .refine((r) => r.from <= r.to, {
    message: "'from' is after 'to'.",
    path: ["from"],
  })
export type PartyStatementInput = z.input<typeof partyStatementInputSchema>

export interface PartyStatementLine {
  readonly date: IsoDate
  readonly entryId: string
  readonly narration: string
  readonly account: { readonly code: string; readonly name: string }
  readonly debit: Money
  readonly credit: Money
  /** Running balance after this line: debit − credit. */
  readonly balance: Money
}

/**
 * Every ledger line with this party, in date order. Balances are debit −
 * credit: positive means they owe us (or we've paid them in advance),
 * negative means we owe them.
 */
export interface PartyStatement {
  readonly party: PartyRef
  readonly from: IsoDate
  readonly to: IsoDate
  /** Balance before this page's first line. */
  readonly opening: Money
  readonly lines: readonly PartyStatementLine[]
  /** Balance after this page's last line. */
  readonly closing: Money
  readonly nextCursor: string | null
}
