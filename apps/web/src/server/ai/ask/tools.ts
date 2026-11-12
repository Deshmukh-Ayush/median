import "server-only"

import {
  idSchema,
  isoDateSchema,
  isServiceError,
  listEntriesFiltersSchema,
  listInboxFiltersSchema,
  listInvoicesFiltersSchema,
  listPartiesFiltersSchema,
  periodSchema,
} from "@workspace/contracts"
import { tool } from "ai"
import { z } from "zod"

import {
  getBalanceSheet,
  getCashPosition,
  getDashboardSummary,
  getGstSummary,
  getInvoice,
  getProfitAndLoss,
  getReceivablesAgeing,
  getRevenueBreakdown,
  getTrialBalance,
  listEntries,
  listInboxItems,
  listInvoices,
  listParties,
} from "@/server/services"
import type { OrgContext } from "@/server/services"

import type { AskToolName } from "@/lib/ask-tools"

import { sources } from "./sources"
import type { AskSource } from "./sources"
import { createDraftTools } from "../tools/drafts"
import { toModelJson } from "./to-model-json"
import type { ModelJson } from "./to-model-json"

/**
 * What every Ask Median tool returns. `data` is the service result with money
 * already formatted; `sources` are the pages that show it. A failure the
 * user should hear about (no access, not found, bad input) comes back as
 * `ok: false` so the model can say so instead of guessing.
 */
export type AskToolResult =
  | {
      readonly ok: true
      readonly data: ModelJson
      readonly sources: readonly AskSource[]
    }
  | { readonly ok: false; readonly error: string; readonly message: string }

/** Rows per page: enough to answer, small enough to keep the prompt cheap. */
const PAGE_LIMIT = 25

const cursorField = z
  .string()
  .max(500)
  .nullable()
  .default(null)
  .describe("nextCursor from a previous call, to read the next page.")

async function run<T>(
  load: () => Promise<T>,
  sourcesOf: (result: T) => readonly AskSource[]
): Promise<AskToolResult> {
  try {
    const result = await load()
    return { ok: true, data: toModelJson(result), sources: sourcesOf(result) }
  } catch (error) {
    if (isServiceError(error)) {
      return { ok: false, error: error.code, message: error.message }
    }
    throw error
  }
}

/**
 * The read-only tools Ask Median may call, bound to the signed-in user's
 * context. Each wraps one existing service, which checks the organisation and
 * the role itself. None of them posts, approves or changes anything.
 */
export function createAskTools(
  ctx: OrgContext,
  draft: { conversationId: string | null; today: string } = {
    conversationId: null,
    today: "",
  }
) {
  return {
    getDashboardSummary: tool({
      description:
        "Headline numbers for the home screen: money in, money owed to you, cash, tax due, recent months.",
      inputSchema: z.object({}),
      execute: () =>
        run(
          () => getDashboardSummary(ctx),
          () => [sources.dashboard()]
        ),
    }),

    getProfitAndLoss: tool({
      description:
        "Profit and loss (income, expenses, net profit) for a date range.",
      inputSchema: z.object({ from: isoDateSchema, to: isoDateSchema }),
      execute: ({ from, to }) =>
        run(
          () => getProfitAndLoss(ctx, from, to),
          () => [sources.profitAndLoss(from, to)]
        ),
    }),

    getBalanceSheet: tool({
      description: "Balance sheet (assets, liabilities, equity) as of a date.",
      inputSchema: z.object({ asOf: isoDateSchema }),
      execute: ({ asOf }) =>
        run(
          () => getBalanceSheet(ctx, asOf),
          () => [sources.balanceSheet(asOf)]
        ),
    }),

    getTrialBalance: tool({
      description:
        "Trial balance: every account's debit and credit totals as of a date.",
      inputSchema: z.object({ asOf: isoDateSchema }),
      execute: ({ asOf }) =>
        run(
          () => getTrialBalance(ctx, asOf),
          () => [sources.trialBalance(asOf)]
        ),
    }),

    listEntries: tool({
      description:
        "Posted journal entries, newest first. Filter by date range, account id (from a report row), party id, source, or narration text.",
      inputSchema: z.object({
        ...listEntriesFiltersSchema.shape,
        cursor: cursorField,
      }),
      execute: ({ cursor, ...filters }) =>
        run(
          () => listEntries(ctx, filters, cursor, { limit: PAGE_LIMIT }),
          () => [sources.journal(filters)]
        ),
    }),

    listInvoices: tool({
      description:
        "Sales invoices, newest first. Filter by status, customer (party id) or invoice date range.",
      inputSchema: z.object({
        ...listInvoicesFiltersSchema.shape,
        cursor: cursorField,
      }),
      execute: ({ cursor, ...filters }) =>
        run(
          () => listInvoices(ctx, cursor, filters, { limit: PAGE_LIMIT }),
          (page) => [
            sources.invoices(filters.partyId),
            ...page.items.map((i) => sources.invoice(i.id, i.number)),
          ]
        ),
    }),

    getInvoice: tool({
      description:
        "One invoice with its lines, tax and payment status, by invoice id.",
      inputSchema: z.object({ id: idSchema }),
      execute: ({ id }) =>
        run(
          async () => {
            const invoice = await getInvoice(ctx, id)
            if (!invoice) return { found: false }
            return invoice
          },
          (invoice) =>
            "number" in invoice
              ? [sources.invoice(invoice.id, invoice.number)]
              : []
        ),
    }),

    getReceivablesAgeing: tool({
      description:
        "Money owed to you by customers, bucketed by days past due (not due, 1–30, 31–60, 61–90, over 90), as of today.",
      inputSchema: z.object({ cursor: cursorField }),
      execute: ({ cursor }) =>
        run(
          () => getReceivablesAgeing(ctx, cursor, { limit: PAGE_LIMIT }),
          () => [sources.receivablesAgeing()]
        ),
    }),

    getGstSummary: tool({
      description:
        "GST for one month: outward supplies by rate, credit notes, input tax credit, TDS, net payable.",
      inputSchema: z.object({
        period: periodSchema.describe("The month, as YYYY-MM."),
      }),
      execute: ({ period }) =>
        run(
          () => getGstSummary(ctx, period),
          () => [sources.gst(period)]
        ),
    }),

    getRevenueBreakdown: tool({
      description:
        "Revenue for a date range, by stream (income account) and by customer.",
      inputSchema: z.object({
        from: isoDateSchema,
        to: isoDateSchema,
        cursor: cursorField,
      }),
      execute: ({ from, to, cursor }) =>
        run(
          () =>
            getRevenueBreakdown(ctx, from, to, cursor, { limit: PAGE_LIMIT }),
          () => [sources.revenue(from, to)]
        ),
    }),

    getCashPosition: tool({
      description:
        "Bank and cash balances as of a date, with reconciliation status.",
      inputSchema: z.object({ asOf: isoDateSchema }),
      execute: ({ asOf }) =>
        run(
          () => getCashPosition(ctx, asOf),
          () => [sources.cash()]
        ),
    }),

    listInboxItems: tool({
      description:
        "Items in the AI inbox waiting for review (or approved/rejected), newest first: bills, bank lines, Razorpay records.",
      inputSchema: z.object({
        ...listInboxFiltersSchema.shape,
        cursor: cursorField,
      }),
      execute: ({ cursor, ...filters }) =>
        run(
          () => listInboxItems(ctx, cursor, filters, { limit: PAGE_LIMIT }),
          () => [sources.inbox()]
        ),
    }),

    listParties: tool({
      description:
        "Customers and vendors, with GSTIN and state. Search by name; filter by kind.",
      inputSchema: z.object({
        ...listPartiesFiltersSchema.shape,
        cursor: cursorField,
      }),
      execute: ({ cursor, ...filters }) =>
        run(
          () => listParties(ctx, cursor, filters, { limit: PAGE_LIMIT }),
          (page) => [
            sources.parties(),
            ...page.items.map((p) => sources.party(p.id, p.name)),
          ]
        ),
    }),
    ...createDraftTools(ctx, draft.conversationId, draft.today),
  }
}

export type AskTools = ReturnType<typeof createAskTools>

// Every tool has a label for the UI, and every label a tool.
export type AskToolLabelsMatch = [keyof AskTools] extends [AskToolName]
  ? [AskToolName] extends [keyof AskTools]
    ? true
    : never
  : never
const labelsMatch: AskToolLabelsMatch = true
void labelsMatch
