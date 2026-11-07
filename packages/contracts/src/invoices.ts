// Sales invoices and receivables. Amounts are integer paise (Money); all GST
// and totals are computed by @workspace/ledger, never sent by the client.

import type { Money } from "@workspace/ledger"
import { z } from "zod"

import {
  gstStateCodeSchema,
  idSchema,
  isoDateSchema,
  moneySchema,
} from "./common"
import type { IsoDate, IsoTimestamp, PartyRef } from "./common"

export type InvoiceStatus = "issued" | "partially_paid" | "paid" | "cancelled"

/**
 * Rule 6. intrastate = CGST + SGST, interstate = IGST. Exports and SEZ
 * supplies are interstate; export under LUT is zero-rated.
 */
export type InvoiceSupplyType =
  "intrastate" | "interstate" | "export_with_payment" | "export_lut" | "sez"

/** GST rates in basis points (18% = 1800). */
export const GST_RATES_BPS = [0, 25, 300, 500, 1200, 1800, 2800, 4000] as const

export interface InvoiceLine {
  readonly id: string
  readonly description: string
  readonly hsnSac: string
  /** Decimal string, up to 3 places: "1", "7.5". */
  readonly quantity: string
  readonly unitPrice: Money
  readonly gstRateBps: number
  readonly taxable: Money
  readonly cgst: Money
  readonly sgst: Money
  readonly igst: Money
  readonly total: Money
}

export interface Invoice {
  readonly id: string
  /** e.g. "INV/2026-27/0042" (at most 16 characters, rule 5). */
  readonly number: string
  /** e.g. "2026-27" */
  readonly financialYear: string
  readonly party: PartyRef
  readonly invoiceDate: IsoDate
  readonly dueDate: IsoDate
  /** Two-digit GST state code; "96" for exports. */
  readonly placeOfSupply: string
  readonly supplyType: InvoiceSupplyType
  /** The recipient pays the GST; the invoice charges none. */
  readonly reverseCharge: boolean
  readonly lines: readonly InvoiceLine[]
  readonly taxable: Money
  readonly cgst: Money
  readonly sgst: Money
  readonly igst: Money
  /** -50 to +50 paise, rounding the total to the rupee (rule 7). */
  readonly roundOff: Money
  readonly total: Money
  /** Received against it (receipts, including TDS deducted). */
  readonly paid: Money
  /** Credit notes issued against it. */
  readonly credited: Money
  /** total − paid − credited, never below zero. */
  readonly outstanding: Money
  readonly status: InvoiceStatus
  readonly notes: string | null
  readonly journalEntryId: string | null
  readonly createdAt: IsoTimestamp
}

export type InvoiceListItem = Omit<Invoice, "lines">

const invoiceLineInputSchema = z.object({
  description: z.string().trim().min(1).max(500),
  hsnSac: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "HSN/SAC is 4–8 digits"),
  quantity: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,3})?$/, "Quantity like 1 or 7.5")
    .refine((q) => !/^0+(\.0+)?$/.test(q), "Quantity must be more than zero"),
  unitPrice: moneySchema.refine((v) => v >= 0n, "Price can't be negative"),
  gstRateBps: z.union(GST_RATES_BPS.map((r) => z.literal(r))),
  /** Income account to credit; defaults to the org's revenue account. */
  revenueAccountId: idSchema.nullish(),
})

export const createInvoiceInputSchema = z
  .object({
    partyId: idSchema,
    invoiceDate: isoDateSchema,
    dueDate: isoDateSchema,
    /**
     * Omitted: the customer's state, else the org's state (rule 6, unknown
     * B2C place of supply). Use "96" for exports.
     */
    placeOfSupply: gstStateCodeSchema.nullish(),
    /** Exports and SEZ supplies (rule 6). */
    specialSupply: z
      .enum(["export_with_payment", "export_lut", "sez"])
      .nullish(),
    reverseCharge: z.boolean().default(false),
    notes: z.string().trim().max(2000).nullish(),
    lines: z.array(invoiceLineInputSchema).min(1).max(100),
  })
  .refine((i) => i.dueDate >= i.invoiceDate, {
    message: "Due date is before the invoice date",
    path: ["dueDate"],
  })
export type CreateInvoiceInput = z.input<typeof createInvoiceInputSchema>

/** What createInvoice would issue, computed without saving anything. */
export interface InvoicePreview {
  /** The number the next invoice would get; another invoice may take it first. */
  readonly nextNumber: string
  readonly financialYear: string
  readonly placeOfSupply: string
  readonly supplyType: InvoiceSupplyType
  readonly reverseCharge: boolean
  /** False when no GST is charged (unregistered, composition, LUT, reverse charge). */
  readonly chargesGst: boolean
  readonly lines: readonly Omit<InvoiceLine, "id">[]
  readonly taxable: Money
  readonly cgst: Money
  readonly sgst: Money
  readonly igst: Money
  readonly roundOff: Money
  readonly total: Money
  /** Things to check before issuing, e.g. a locked period or a missing GSTIN. */
  readonly warnings: readonly string[]
}

export const listInvoicesFiltersSchema = z
  .object({
    status: z
      .enum(["issued", "partially_paid", "paid", "cancelled"])
      .optional(),
    partyId: idSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, {
    message: "'from' is after 'to'.",
    path: ["from"],
  })
export type ListInvoicesFilters = z.input<typeof listInvoicesFiltersSchema>

/** Outstanding receivables by days past the due date. */
export interface AgeingBuckets {
  /** Not yet due. */
  readonly notDue: Money
  readonly days1To30: Money
  readonly days31To60: Money
  readonly days61To90: Money
  readonly over90: Money
  readonly total: Money
}

export interface PartyAgeing extends AgeingBuckets {
  readonly party: PartyRef
  readonly openInvoices: number
}

export interface ReceivablesAgeing {
  /** Today in India (IST); days overdue are counted to this date. */
  readonly asOf: IsoDate
  /** Across every customer, not just this page. */
  readonly totals: AgeingBuckets
  /** Customers with something outstanding, by name. */
  readonly parties: {
    readonly items: readonly PartyAgeing[]
    readonly nextCursor: string | null
  }
}
