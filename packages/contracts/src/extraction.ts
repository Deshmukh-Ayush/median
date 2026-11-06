// Bill extraction: the AI copies what is printed; Median's code parses
// amounts, recomputes tax and totals, and cross-checks the printed ones.

import { z } from "zod"

/** Amount text as printed on a document. The AI copies it; code parses it. */
export const printedAmountSchema = z
  .string()
  .describe(
    'Amount exactly as printed, in rupees, e.g. "1,18,000.00". No maths.'
  )

/**
 * What the AI extracts from a vendor bill: text as printed, no calculations.
 * The AI module's output schema extends this one. Optional fields may be
 * omitted by callers that don't read them.
 */
export const billExtractionSchema = z.object({
  vendor: z.object({
    name: z.string().min(1),
    gstin: z.string().nullable().describe("15-character GSTIN, or null"),
    stateCode: z
      .string()
      .nullable()
      .describe('Two-digit GST state code, e.g. "29"'),
  }),
  billNumber: z.string().min(1),
  billDate: z.string().describe("YYYY-MM-DD"),
  dueDate: z.string().nullable().describe("YYYY-MM-DD, or null"),
  /** Place of supply text as printed, e.g. "Karnataka (29)". */
  placeOfSupply: z.string().nullable().optional(),
  placeOfSupplyStateCode: z.string().nullable(),
  currency: z.string().describe('ISO currency code as printed, usually "INR"'),
  lines: z
    .array(
      z.object({
        description: z.string(),
        hsnSac: z.string().nullable(),
        quantity: z
          .string()
          .nullable()
          .describe('As printed, e.g. "2" or "1.5"'),
        /** Unit price as printed. */
        rate: printedAmountSchema.nullable().optional(),
        taxableAmount: printedAmountSchema,
        gstRatePercent: z
          .string()
          .nullable()
          .describe('GST rate as printed, e.g. "18" for 18%'),
        /** This line's printed tax amounts, for cross-checking only. */
        cgstAmount: printedAmountSchema.nullable().optional(),
        sgstAmount: printedAmountSchema.nullable().optional(),
        igstAmount: printedAmountSchema.nullable().optional(),
      })
    )
    .min(1),
  printedTotals: z.object({
    taxable: printedAmountSchema.nullable(),
    cgst: printedAmountSchema.nullable(),
    sgst: printedAmountSchema.nullable(),
    igst: printedAmountSchema.nullable(),
    total: printedAmountSchema.nullable(),
  }),
})
export type BillExtraction = z.infer<typeof billExtractionSchema>

/**
 * A flag on an extracted field.
 * - `needs_review`: uncertain or failed a deterministic check; a human checks it.
 * - `not_printed`: the value isn't on the document. Informational.
 */
export const reviewFlagSchema = z.object({
  /** Field path, e.g. "vendor.gstin" or "lines[2].hsnSac". */
  field: z.string().min(1).max(200),
  kind: z.enum(["needs_review", "not_printed"]),
  reason: z.string().min(1).max(500),
  /** "check": a deterministic check. "model": the model's own flag. */
  source: z.enum(["check", "model"]),
})
export type ReviewFlag = z.infer<typeof reviewFlagSchema>

/** Review flags passed to createInboxItemFromExtraction and shown in the inbox. */
export const billReviewSchema = z.object({
  needsReview: z.array(reviewFlagSchema).max(200).default([]),
  notPrinted: z.array(reviewFlagSchema).max(200).default([]),
})
export type BillReview = z.output<typeof billReviewSchema>
export type BillReviewInput = z.input<typeof billReviewSchema>
