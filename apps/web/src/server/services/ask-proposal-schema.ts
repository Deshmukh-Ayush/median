import type { Money } from "@workspace/ledger"
import { paise } from "@workspace/ledger"
import {
  GST_RATES_BPS,
  ServiceError,
  idSchema,
  isoDateSchema,
} from "@workspace/contracts"
import type { CreateInvoiceInput } from "@workspace/contracts"
import { z } from "zod"

// inbox_items.proposal for kind 'ask_proposal' (JSON: paise as strings).
// Its own module so inbox.ts and ask-proposals.ts can both import it.

const paiseString = z.string().regex(/^\d+$/)

const invoiceLineJsonSchema = z.object({
  description: z.string(),
  hsnSac: z.string(),
  quantity: z.string(),
  unitPrice: paiseString,
  gstRateBps: z.union(GST_RATES_BPS.map((r) => z.literal(r))),
})

export const askProposalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("journal") }),
  z.object({
    type: z.literal("invoice"),
    customerName: z.string(),
    input: z.object({
      partyId: idSchema,
      invoiceDate: isoDateSchema,
      dueDate: isoDateSchema,
      lines: z.array(invoiceLineJsonSchema).min(1),
    }),
  }),
])
export type AskProposal = z.infer<typeof askProposalSchema>

/** The stored invoice proposal as createInvoice input (paise → bigint). */
export function toCreateInvoiceInput(
  p: Extract<AskProposal, { type: "invoice" }>
): CreateInvoiceInput {
  return {
    ...p.input,
    lines: p.input.lines.map((l) => ({ ...l, unitPrice: BigInt(l.unitPrice) })),
  }
}

// Pure: no database.
export interface JournalLineInput {
  readonly accountName: string
  readonly debitPaise?: bigint | undefined
  readonly creditPaise?: bigint | undefined
}

/**
 * Pure: at least two lines, each exactly one positive side, debits equal
 * credits. Throws UNBALANCED or VALIDATION; returns the totals.
 */
export function checkJournalLines(lines: readonly JournalLineInput[]): {
  debit: Money
  credit: Money
} {
  if (lines.length < 2)
    throw new ServiceError("VALIDATION", "A journal needs at least two lines.")
  let debit = 0n
  let credit = 0n
  for (const l of lines) {
    const d = l.debitPaise ?? 0n
    const c = l.creditPaise ?? 0n
    if (d < 0n || c < 0n || d > 0n === c > 0n)
      throw new ServiceError(
        "VALIDATION",
        `Line "${l.accountName}" needs a debit or a credit above zero, not both.`
      )
    debit += d
    credit += c
  }
  if (debit !== credit)
    throw new ServiceError(
      "UNBALANCED",
      `Debits (${debit} paise) don't equal credits (${credit} paise).`
    )
  return { debit: paise(debit), credit: paise(credit) }
}
