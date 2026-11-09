import type { Money } from "@workspace/ledger"
import { z } from "zod"

import { idSchema, isoDateSchema, moneySchema } from "./common"
import type { IsoTimestamp } from "./common"
import type { BillReview } from "./extraction"
import type { ProposedEntryView } from "./proposed-entry"

export type InboxItemKind =
  "bill" | "bank_line" | "razorpay_record" | "settlement_gap"
export type InboxStatus = "pending" | "approved" | "rejected"

/**
 * Income-tax sections a customer may deduct TDS under on our receipts
 * (rule 11), and the common ones on vendor bills.
 */
export const TDS_SECTIONS = [
  "194C",
  "194H",
  "194I",
  "194J",
  "194O",
  "194Q",
  "194R",
] as const
export type TdsSection = (typeof TDS_SECTIONS)[number]

/** The GST split behind a proposed entry, shown and editable in the inbox. */
export interface InboxGstSplit {
  readonly taxable: Money
  readonly cgst: Money
  readonly sgst: Money
  readonly igst: Money
  /** Basis points (18% = 1800). Null when lines carry different rates. */
  readonly rateBps: number | null
  /** Null when no GST applies (e.g. a salary payment). */
  readonly supplyType: "intrastate" | "interstate" | null
}

/** TDS deducted (rule 11), booked to TDS receivable on approval. */
export interface InboxTds {
  readonly section: TdsSection
  readonly rateBps: number
  readonly amount: Money
}

export interface InboxItem {
  readonly id: string
  readonly kind: InboxItemKind
  readonly status: InboxStatus
  /** 0–1. Compare with CONFIDENCE_HIGH / CONFIDENCE_MEDIUM. */
  readonly confidence: number
  /** Why this needs a human, in plain words. */
  readonly reason: string
  readonly sourceRef: {
    readonly type: "document" | "source_record"
    readonly id: string
  }
  /** Signed, short-lived URL of the source document (bill, statement); null for API records. */
  readonly sourceDocumentUrl: string | null
  /** The entry to post on approval, with account and party names on each line. */
  readonly proposedEntry: ProposedEntryView
  /** Null when the entry carries no GST. */
  readonly gst: InboxGstSplit | null
  /** Null when no TDS was deducted. */
  readonly tds: InboxTds | null
  /** Flags from extraction review checks; empty for rule-generated items. */
  readonly reviewFlags: BillReview
  readonly reviewedBy: string | null
  readonly reviewedAt: IsoTimestamp | null
  readonly reviewNote: string | null
  /**
   * Refunds of an invoiced sale that couldn't become a credit note
   * automatically: the invoice and the refund amount, so the item can offer
   * "create credit note". Null for everything else.
   */
  readonly refund?: {
    readonly invoiceId: string
    readonly invoiceNumber: string
    readonly amount: Money
  } | null
  /** Set once approved and posted. */
  readonly postedEntryId: string | null
  readonly createdAt: IsoTimestamp
}

export const listInboxFiltersSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  kind: z
    .enum(["bill", "bank_line", "razorpay_record", "settlement_gap"])
    .optional(),
})
export type ListInboxFilters = z.input<typeof listInboxFiltersSchema>

const nonNegativeMoney = moneySchema.refine(
  (v) => v >= 0n,
  "Amount can't be negative"
)

/**
 * Changes the reviewer made before approving. Omitted fields keep the
 * proposal. When `gst` or `tds` is given, the backend rebuilds the tax and TDS
 * lines from them and checks the result in code (the UI never computes tax);
 * `tds: null` removes TDS.
 */
export const inboxEditsSchema = z.object({
  entryDate: isoDateSchema.optional(),
  narration: z.string().trim().min(1).max(500).optional(),
  lines: z
    .array(
      z.object({
        accountId: idSchema,
        partyId: idSchema.nullable(),
        debit: moneySchema,
        credit: moneySchema,
        description: z.string().max(500).nullable(),
      })
    )
    .min(2)
    .optional(),
  gst: z
    .object({
      taxable: nonNegativeMoney,
      cgst: nonNegativeMoney,
      sgst: nonNegativeMoney,
      igst: nonNegativeMoney,
    })
    .refine((g) => g.igst === 0n || (g.cgst === 0n && g.sgst === 0n), {
      message: "Use either CGST + SGST or IGST, not both",
    })
    .optional(),
  tds: z
    .object({
      section: z.enum(TDS_SECTIONS),
      rateBps: z.int().min(1).max(10_000),
      amount: nonNegativeMoney,
    })
    .nullable()
    .optional(),
})
export type InboxEdits = z.input<typeof inboxEditsSchema>

export interface ApproveInboxItemResult {
  readonly item: InboxItem
  readonly entryId: string
}

export const BULK_APPROVE_MAX = 50

export const bulkApproveInboxItemsInputSchema = z
  .array(idSchema)
  .min(1)
  .max(BULK_APPROVE_MAX, `Approve at most ${BULK_APPROVE_MAX} items at a time`)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate ids")

/** Each item is approved on its own; one failure doesn't stop the rest. */
export interface BulkApproveResult {
  readonly approved: readonly {
    readonly id: string
    readonly entryId: string
  }[]
  readonly failed: readonly {
    readonly id: string
    /** A ServiceErrorCode, e.g. "PERIOD_LOCKED" or "CONFLICT". */
    readonly code: string
    readonly message: string
  }[]
}
