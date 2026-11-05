import "server-only"

import { paise, parseRupees } from "@workspace/ledger"
import { z } from "zod"

import type { OrgContext } from "./context"
import { assertCan } from "./context"
import type { InboxItem } from "./inbox"
import { STUB_ACCOUNTS, STUB_PARTIES } from "./stub-data"
import { idSchema, parseInput } from "./types"

const amountText = z
  .string()
  .describe(
    'Amount exactly as printed, in rupees, e.g. "1,18,000.00". No maths.'
  )

/**
 * What the AI extracts from a vendor bill: text as printed on the document,
 * no calculations. Use this as the AI output schema. Median parses amounts and
 * computes tax and totals itself, and cross-checks them against
 * `printedTotals`.
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
        taxableAmount: amountText,
        gstRatePercent: z
          .string()
          .nullable()
          .describe('GST rate as printed, e.g. "18" for 18%'),
      })
    )
    .min(1),
  printedTotals: z.object({
    taxable: amountText.nullable(),
    cgst: amountText.nullable(),
    sgst: amountText.nullable(),
    igst: amountText.nullable(),
    total: amountText.nullable(),
  }),
})
export type BillExtraction = z.infer<typeof billExtractionSchema>

/**
 * Turns a validated bill extraction into a pending purchase entry with input
 * tax credit. Tax and totals are computed in code; the AI's output is only
 * read. Throws VALIDATION if the extraction doesn't match the schema. STUB:
 * returns a fixed proposal; Day 4 computes it from the extraction.
 */
export async function createInboxItemFromExtraction(
  ctx: OrgContext,
  documentId: string,
  extraction: unknown
): Promise<InboxItem> {
  assertCan(ctx, "ledger", "propose")
  const docId = parseInput(idSchema, documentId)
  const bill = parseInput(billExtractionSchema, extraction)
  const taxable = bill.lines.reduce(
    (sum, l) => sum + parseRupees(l.taxableAmount),
    0n
  )
  // Placeholder maths for the stub only (9% + 9%); Day 4 replaces it.
  const halfTax = (taxable * 900n) / 10_000n
  await Promise.resolve()
  return {
    id: crypto.randomUUID(),
    kind: "bill",
    status: "pending",
    confidence: 0.8,
    reason: `Bill ${bill.billNumber} from ${bill.vendor.name}. Check the expense account.`,
    sourceRef: { type: "document", id: docId },
    proposedEntry: {
      entryDate: bill.billDate,
      narration: `${bill.vendor.name} bill ${bill.billNumber}`,
      lines: [
        {
          accountId: STUB_ACCOUNTS.hosting.id,
          partyId: null,
          debit: paise(taxable),
          credit: paise(0n),
          description: null,
        },
        {
          accountId: STUB_ACCOUNTS.inputCgst.id,
          partyId: null,
          debit: paise(halfTax),
          credit: paise(0n),
          description: "CGST",
        },
        {
          accountId: STUB_ACCOUNTS.inputSgst.id,
          partyId: null,
          debit: paise(halfTax),
          credit: paise(0n),
          description: "SGST",
        },
        {
          accountId: STUB_ACCOUNTS.payables.id,
          partyId: STUB_PARTIES.aws.id,
          debit: paise(0n),
          credit: paise(taxable + 2n * halfTax),
          description: null,
        },
      ],
    },
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    postedEntryId: null,
    createdAt: new Date().toISOString(),
  }
}
