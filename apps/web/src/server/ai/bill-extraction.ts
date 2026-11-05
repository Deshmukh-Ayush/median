import "server-only"

import { gstinSchema, isoDateSchema } from "@workspace/contracts"
import { z } from "zod"

import { billExtractionSchema } from "@/server/services/extraction"

/**
 * The AI output schema for vendor bills (GST invoices). It extends the
 * backend's `billExtractionSchema` (the input to
 * `createInboxItemFromExtraction`), so every AI result is a valid
 * `BillExtraction` and nothing is redefined here.
 *
 * Every value is copied as printed. The AI never calculates: no totals, no
 * tax, no rates derived from amounts. Missing or unreadable values are null.
 */

const printed = (example: string) =>
  z
    .string()
    .nullable()
    .describe(`Exactly as printed, e.g. "${example}". Null if not printed.`)

const baseLine = billExtractionSchema.shape.lines.element

const billLineSchema = baseLine.extend({
  rate: printed("1,250.00").describe(
    "Unit price exactly as printed. Null if not printed. Never compute it."
  ),
  cgstAmount: printed("2,250.00").describe(
    "This line's CGST amount as printed. Null if the line shows none."
  ),
  sgstAmount: printed("2,250.00").describe(
    "This line's SGST/UTGST amount as printed. Null if the line shows none."
  ),
  igstAmount: printed("4,500.00").describe(
    "This line's IGST amount as printed. Null if the line shows none."
  ),
})

/** Paths the model can flag, e.g. "vendor.gstin" or "lines[2].hsnSac". */
const fieldPath = z
  .string()
  .describe(
    'Path of the field, e.g. "vendor.gstin", "billDate", "lines[0].hsnSac", "printedTotals.total"'
  )

export const lowConfidenceFieldSchema = z.object({
  field: fieldPath,
  reason: z
    .string()
    .describe("Short reason, e.g. 'blurred', 'partly cut off', 'not printed'"),
})
export type LowConfidenceField = z.infer<typeof lowConfidenceFieldSchema>

export const aiBillExtractionSchema = billExtractionSchema.extend({
  placeOfSupply: printed("Karnataka (29)").describe(
    "Place of supply exactly as printed, with any state code. Null if not printed."
  ),
  lines: z.array(billLineSchema).min(1),
  lowConfidenceFields: z
    .array(lowConfidenceFieldSchema)
    .describe(
      "Every field you are not sure you read correctly, or had to leave null."
    ),
})
export type AiBillExtraction = z.infer<typeof aiBillExtractionSchema>

export const BILL_EXTRACTION_PROMPT = `You read Indian GST invoices (vendor bills) and copy what is printed into the schema.

Rules:
- Copy every amount, rate, quantity and code exactly as printed, keeping Indian digit grouping (e.g. "1,18,000.00"). Do not add, multiply, round or work out any number. If a value is not printed, return null; never compute it from other values.
- Dates: convert the printed date to YYYY-MM-DD. Day comes before month on Indian invoices (05/04/2026 is 5 April 2026).
- vendor is the seller who issued the invoice, not the buyer ("Bill to"). Use the seller's GSTIN.
- placeOfSupply: as printed. placeOfSupplyStateCode: the two-digit code printed with it, or the GST state code of the printed state name; null if no place of supply is printed. vendor.stateCode: the first two digits of the seller's GSTIN, or null.
- One entry in lines per printed line item, in printed order. taxableAmount is the line's taxable value column as printed. gstRatePercent is the line's GST rate as printed, without the % sign. If only split rates are printed (CGST 9%, SGST 9%), return null and flag it; never add them up.
- printedTotals: the invoice's printed summary totals. total is the grand total payable as printed.
- lowConfidenceFields: list every field that was blurred, cut off, ambiguous, or that you left null. Be honest; a reviewer checks these.`

const RATE_PATTERN = /^\d{1,2}(\.\d{1,2})?$/
const AMOUNT_PATTERN = /^-?[\d,]+(\.\d{1,2})?$/

/**
 * Adds deterministic low-confidence flags to the model's own: values that are
 * missing, or that don't match the format they must have (GSTIN, date, state
 * code, amounts). Format checks only; no arithmetic.
 */
export function flagLowConfidence(
  bill: AiBillExtraction
): LowConfidenceField[] {
  const flags = new Map<string, string>()
  for (const flag of bill.lowConfidenceFields) {
    flags.set(flag.field, flag.reason)
  }
  const flag = (field: string, reason: string) => {
    if (!flags.has(field)) flags.set(field, reason)
  }

  if (bill.vendor.gstin === null) flag("vendor.gstin", "not found")
  else if (!gstinSchema.safeParse(bill.vendor.gstin).success)
    flag("vendor.gstin", "not a valid GSTIN format")
  if (!isoDateSchema.safeParse(bill.billDate).success)
    flag("billDate", "not a valid date")
  if (bill.placeOfSupplyStateCode === null)
    flag("placeOfSupplyStateCode", "not found")
  else if (!/^\d{2}$/.test(bill.placeOfSupplyStateCode))
    flag("placeOfSupplyStateCode", "not a two-digit state code")
  if (bill.printedTotals.total === null)
    flag("printedTotals.total", "not found")

  bill.lines.forEach((line, i) => {
    if (line.hsnSac === null) flag(`lines[${i}].hsnSac`, "not found")
    else if (!/^\d{4,8}$/.test(line.hsnSac.replace(/\s/g, "")))
      flag(`lines[${i}].hsnSac`, "not a 4–8 digit HSN/SAC code")
    if (line.gstRatePercent === null)
      flag(`lines[${i}].gstRatePercent`, "not found")
    else if (!RATE_PATTERN.test(line.gstRatePercent.replace("%", "").trim()))
      flag(`lines[${i}].gstRatePercent`, "not a rate")
    if (!AMOUNT_PATTERN.test(line.taxableAmount.replace(/[₹\s]/g, "")))
      flag(`lines[${i}].taxableAmount`, "not an amount")
  })

  return [...flags].map(([field, reason]) => ({ field, reason }))
}
