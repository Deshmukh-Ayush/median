import "server-only"

import { ServiceError } from "@workspace/contracts"
import type { BankRow } from "@workspace/contracts"
import { generateText, NoObjectGeneratedError, Output } from "ai"

import { parseStatementDate } from "@/lib/statement-date"

import {
  type AiStatementRow,
  aiBankStatementSchema,
  BANK_STATEMENT_PROMPT,
} from "./bank-statement-extraction"
import { fastModel, requireRealDataAllowed } from "./models"

export interface StatementDocument {
  data: Uint8Array
  filename?: string
}

const UNREADABLE =
  "We couldn't read this statement. Try the CSV export instead."

/**
 * A row as printed → the backend's BankRow shape. Only the date is
 * normalised (by code, day first); an unreadable date is passed on as
 * printed so importFile reports that row instead of us guessing.
 */
export function toBankRow(row: AiStatementRow): BankRow {
  const clean = (text: string | null) => {
    const trimmed = text?.trim() ?? ""
    return trimmed === "" ? null : trimmed
  }
  return {
    date: parseStatementDate(row.date) ?? row.date,
    description: row.description.trim(),
    reference: clean(row.reference),
    debit: clean(row.debit),
    credit: clean(row.credit),
    balance: clean(row.balance),
  }
}

/**
 * Reads a PDF bank statement with `fastModel` into BankRow-shaped rows for
 * `importFile(ctx, "bank-statement", { kind: "rows", … })`. The AI only
 * copies lines; matching and posting are the backend's deterministic code,
 * and unmatched lines go to the inbox.
 *
 * Gemini free tier: synthetic test statements only, never real ones.
 */
export async function extractBankStatement(
  document: StatementDocument
): Promise<BankRow[]> {
  requireRealDataAllowed()
  let raw: unknown
  try {
    const result = await generateText({
      model: fastModel,
      temperature: 0,
      system: BANK_STATEMENT_PROMPT,
      output: Output.object({ schema: aiBankStatementSchema }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              data: document.data,
              mediaType: "application/pdf",
              ...(document.filename ? { filename: document.filename } : {}),
            },
            { type: "text", text: "Copy every transaction line." },
          ],
        },
      ],
    })
    raw = result.output
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new ServiceError("VALIDATION", UNREADABLE, { cause: error.message })
    }
    throw error
  }

  // AI output is external data: parse it again before use.
  const parsed = aiBankStatementSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ServiceError("VALIDATION", UNREADABLE, {
      issues: parsed.error.issues,
    })
  }
  if (parsed.data.rows.length === 0) {
    throw new ServiceError(
      "VALIDATION",
      "We found no transactions in this statement."
    )
  }
  return parsed.data.rows.map(toBankRow)
}
