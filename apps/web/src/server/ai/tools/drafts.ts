import "server-only"

import { GST_RATES_BPS, isServiceError } from "@workspace/contracts"
import { tool } from "ai"
import { z } from "zod"

import { proposeInvoice, proposeJournal } from "@/server/services"
import type { OrgContext } from "@/server/services"

import { sources } from "../ask/sources"
import type { AskToolResult } from "../ask/tools"
import { toModelJson } from "../ask/to-model-json"

// Ask Median's only write tools. They PROPOSE: each creates an inbox item
// ("Proposed by Ask Median") that a person approves or rejects. Nothing here
// posts to the ledger. Amounts are checked and GST computed in code.

const paiseField = z
  .number()
  .int()
  .positive()
  .max(1e14)
  .describe("Integer paise: ₹1 = 100 paise, so ₹50,000 is 5000000.")

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

async function propose<T>(load: () => Promise<T>): Promise<AskToolResult> {
  try {
    const result = await load()
    return { ok: true, data: toModelJson(result), sources: [sources.inbox()] }
  } catch (error) {
    if (isServiceError(error))
      return { ok: false, error: error.code, message: error.message }
    throw error
  }
}

const big = (n: number | undefined) => (n === undefined ? undefined : BigInt(n))

export function createDraftTools(
  ctx: OrgContext,
  conversationId: string | null,
  today: string
) {
  return {
    proposeJournal: tool({
      description:
        "Sends a journal entry to the inbox for a person to approve. Posts nothing. ONLY call after you have stated the exact entry and the user said yes. Fails if debits don't equal credits, an account name is unknown or matches several (then ask the user).",
      inputSchema: z.object({
        narration: z.string().trim().min(1).max(500),
        date: isoDate,
        lines: z
          .array(
            z.object({
              accountName: z.string().trim().min(1).max(200),
              debitPaise: paiseField.optional(),
              creditPaise: paiseField.optional(),
            })
          )
          .min(2)
          .max(20),
      }),
      execute: (input) =>
        propose(() =>
          proposeJournal(
            ctx,
            {
              narration: input.narration,
              date: input.date,
              lines: input.lines.map((l) => ({
                accountName: l.accountName,
                debitPaise: big(l.debitPaise),
                creditPaise: big(l.creditPaise),
              })),
            },
            conversationId
          )
        ),
    }),

    proposeInvoice: tool({
      description:
        "Sends a sales invoice to the inbox for a person to approve. Issues and posts nothing. GST, place of supply, totals and the number are computed in code. ONLY call after you have stated the exact invoice and the user said yes. Each line: an amount, or a rate and quantity. Fails if the customer is unknown or ambiguous (then ask the user).",
      inputSchema: z.object({
        customerName: z.string().trim().min(1).max(200),
        date: isoDate.optional().describe("Invoice date; default today."),
        lines: z
          .array(
            z.object({
              description: z.string().trim().min(1).max(500),
              hsnSac: z
                .string()
                .regex(/^\d{4,8}$/)
                .describe("HSN/SAC code the user gave, e.g. 998311."),
              gstRatePercent: z
                .union(GST_RATES_BPS.map((r) => z.literal(r / 100)))
                .describe("GST rate in percent the user gave, e.g. 18."),
              amountPaise: paiseField.optional(),
              ratePaise: paiseField.optional(),
              quantity: z
                .string()
                .regex(/^\d{1,9}(\.\d{1,3})?$/)
                .optional(),
            })
          )
          .min(1)
          .max(20),
      }),
      execute: (input) =>
        propose(() =>
          proposeInvoice(
            ctx,
            {
              customerName: input.customerName,
              date: input.date ?? today,
              lines: input.lines.map((l) => ({
                description: l.description,
                hsnSac: l.hsnSac,
                gstRateBps: GST_RATES_BPS.find(
                  (r) => r === Math.round(l.gstRatePercent * 100)
                )!,
                amountPaise: big(l.amountPaise),
                ratePaise: big(l.ratePaise),
                quantity: l.quantity,
              })),
            },
            conversationId
          )
        ),
    }),
  }
}
