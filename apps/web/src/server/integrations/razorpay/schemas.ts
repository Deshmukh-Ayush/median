import { z } from "zod"

// Zod schemas for the Razorpay API responses we read. Unknown fields are kept
// (loose objects) so the full payload can be stored on the source record.
// Amounts are integer paise; timestamps are Unix seconds.

const paiseAmount = z.int().nonnegative()
const unixSeconds = z.int().positive()

/** Razorpay sends `notes` as an object, or an empty array when there are none. */
const notesSchema = z
  .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
  .transform((notes) => (Array.isArray(notes) ? {} : notes))

export const razorpayPaymentSchema = z.looseObject({
  id: z.string().startsWith("pay_"),
  entity: z.literal("payment"),
  amount: paiseAmount,
  currency: z.string().length(3),
  status: z.enum(["created", "authorized", "captured", "refunded", "failed"]),
  order_id: z.string().nullable(),
  invoice_id: z.string().nullable(),
  method: z.string().nullable(),
  amount_refunded: paiseAmount,
  captured: z.boolean(),
  description: z.string().nullable(),
  email: z.string().nullable(),
  contact: z.string().nullable(),
  notes: notesSchema,
  /** Gateway fee including tax, in paise (null until captured). Rule 9: use as given. */
  fee: paiseAmount.nullable(),
  /** GST on the fee, in paise. */
  tax: paiseAmount.nullable(),
  created_at: unixSeconds,
})
export type RazorpayPayment = z.infer<typeof razorpayPaymentSchema>

export const razorpayRefundSchema = z.looseObject({
  id: z.string().startsWith("rfnd_"),
  entity: z.literal("refund"),
  amount: paiseAmount,
  currency: z.string().length(3),
  payment_id: z.string().startsWith("pay_"),
  notes: notesSchema,
  status: z.enum(["pending", "processed", "failed"]),
  created_at: unixSeconds,
})
export type RazorpayRefund = z.infer<typeof razorpayRefundSchema>

export const razorpaySettlementSchema = z.looseObject({
  id: z.string().startsWith("setl_"),
  entity: z.literal("settlement"),
  amount: paiseAmount,
  status: z.enum(["created", "processed", "failed"]),
  /** Total fees and tax deducted in this settlement, in paise. */
  fees: paiseAmount,
  tax: paiseAmount,
  utr: z.string().nullable(),
  created_at: unixSeconds,
})
export type RazorpaySettlement = z.infer<typeof razorpaySettlementSchema>

/**
 * One row of the settlement reconciliation report
 * (GET /settlements/recon/combined): ties a payment, refund or adjustment to
 * the settlement it was paid out in.
 */
export const razorpayReconItemSchema = z.looseObject({
  entity_id: z.string(),
  type: z.string(),
  debit: paiseAmount,
  credit: paiseAmount,
  amount: paiseAmount,
  currency: z.string().length(3),
  fee: paiseAmount.nullable(),
  tax: paiseAmount.nullable(),
  settled: z.boolean(),
  settlement_id: z.string().nullable(),
  settlement_utr: z.string().nullable(),
  created_at: unixSeconds,
  settled_at: unixSeconds.nullable(),
})
export type RazorpayReconItem = z.infer<typeof razorpayReconItemSchema>

/** Razorpay list responses: { entity: "collection", count, items }. */
export function collectionSchema<T extends z.ZodType>(item: T) {
  return z.object({
    entity: z.literal("collection"),
    count: z.int().nonnegative(),
    items: z.array(item),
  })
}

export const razorpayErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    description: z.string(),
  }),
})
