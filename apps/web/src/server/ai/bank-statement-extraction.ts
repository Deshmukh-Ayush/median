import "server-only"

import { z } from "zod"

import type { BankRow } from "@/server/services/bank"

/**
 * The AI output schema for PDF bank statements. The model copies each line
 * as printed; it never adds, nets or derives amounts. The rows are then
 * normalised by code (dates to ISO) into the backend's `BankRow` shape and
 * validated row by row by `importFile`, so one misread line is reported
 * instead of failing the whole statement.
 */

const printed = (description: string) =>
  z.string().nullable().describe(description)

const statementRowSchema = z.object({
  date: z
    .string()
    .describe(
      'Transaction (not value) date exactly as printed, e.g. "05/10/2026" or "05 Oct 2026".'
    ),
  description: z
    .string()
    .describe("Narration / particulars as printed, on one line."),
  reference: printed(
    "Cheque number, UTR or reference number as printed. Null if none."
  ),
  debit: printed(
    'Withdrawal amount as printed, without "Dr", e.g. "12,500.00". Null if the line is a deposit.'
  ),
  credit: printed(
    'Deposit amount as printed, without "Cr", e.g. "1,00,000.00". Null if the line is a withdrawal.'
  ),
  balance: printed("Running balance as printed. Null if not printed."),
} satisfies Record<keyof BankRow, z.ZodType>)

export type AiStatementRow = z.infer<typeof statementRowSchema>

export const aiBankStatementSchema = z.object({
  rows: z
    .array(statementRowSchema)
    .describe(
      "Every transaction line, top to bottom, across all pages. Skip opening/closing balance and total lines."
    ),
})
export type AiBankStatement = z.infer<typeof aiBankStatementSchema>

export const BANK_STATEMENT_PROMPT = `You read Indian bank account statements.
Copy every transaction line exactly as printed. Do not calculate, net,
total, round or infer any amount. A line has either a withdrawal (debit) or a
deposit (credit), never both: use the statement's columns or its Dr/Cr marker.
Keep Indian digit grouping as printed (1,00,000.00). Use null for anything
not printed. Ignore opening balance, closing balance, totals and page
headers or footers.`
