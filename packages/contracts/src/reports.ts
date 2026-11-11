// Reports: trial balance, profit and loss, balance sheet and the entry list
// they drill down into.

import type { LineItem, StatementSection } from "@workspace/ledger"
import { z } from "zod"

import type {
  AccountType,
  IsoDate,
  IsoTimestamp,
  JournalEntryView,
  Money,
  PartyRef,
} from "./common"
import { idSchema, isoDateSchema } from "./common"

export type { LineItem, StatementSection }

export interface TrialBalanceRow {
  readonly accountId: string
  readonly code: string
  readonly name: string
  readonly type: AccountType
  /** Closing balance on the debit side (zero if the balance is a credit). */
  readonly debit: Money
  readonly credit: Money
}

export interface TrialBalance {
  readonly asOf: IsoDate
  /** Every account with lines up to `asOf`, by code. */
  readonly rows: readonly TrialBalanceRow[]
  readonly totalDebit: Money
  readonly totalCredit: Money
}

export interface ReportRow {
  /**
   * Ledger account id, or "current-year-profit" / "previous-years-surplus"
   * for the balance sheet's synthetic surplus rows (not drillable).
   */
  readonly accountId: string
  /** Empty for the synthetic surplus rows. */
  readonly code: string
  readonly name: string
  /** Schedule III line item, e.g. "trade_receivables". */
  readonly lineItem: LineItem
  readonly lineItemLabel: string
  /**
   * Positive in the section's natural direction (income credit, expense
   * debit, asset debit…). A contra or flipped balance is negative, e.g.
   * accumulated depreciation.
   */
  readonly amount: Money
}

export interface ReportSection {
  readonly key: StatementSection
  readonly label: string
  /** Rows by account code; zero balances are left out. */
  readonly rows: readonly ReportRow[]
  readonly total: Money
}

export interface ProfitAndLoss {
  readonly from: IsoDate
  readonly to: IsoDate
  /** Schedule III order: revenue from operations, other income. */
  readonly income: readonly ReportSection[]
  /**
   * Schedule III expenses by nature: cost of materials and services,
   * employee benefits, finance costs, depreciation, other expenses.
   */
  readonly expenses: readonly ReportSection[]
  readonly totalIncome: Money
  readonly totalExpenses: Money
  /** Negative for a loss. */
  readonly netProfit: Money
  /**
   * The same period a year earlier (Schedule III comparatives), matched to
   * this one by account id. Absent when not asked for.
   */
  readonly previous?: Omit<ProfitAndLoss, "previous">
}

export interface BalanceSheet {
  readonly asOf: IsoDate
  /** Schedule III: shareholders' funds, non-current liabilities, current liabilities. */
  readonly equityAndLiabilities: readonly ReportSection[]
  /** Schedule III: non-current assets, current assets. */
  readonly assets: readonly ReportSection[]
  readonly totalEquityAndLiabilities: Money
  readonly totalAssets: Money
  /**
   * Profit from the start of the financial year to `asOf`, included in
   * shareholders' funds as "Surplus (current year)".
   */
  readonly currentYearProfit: Money
  /** As of the same day a year earlier (Schedule III comparatives). */
  readonly previous?: Omit<BalanceSheet, "previous">
}

export interface CashFlowLine {
  readonly key: string
  readonly label: string
  /** Positive: cash came in. Negative: cash went out. */
  readonly amount: Money
}

export interface CashFlowSection {
  readonly lines: readonly CashFlowLine[]
  readonly total: Money
}

/**
 * Cash flow statement, indirect method (AS 3). Cash is cash in hand and at
 * bank; money held by payment gateways is a current asset.
 */
export interface CashFlowStatement {
  readonly from: IsoDate
  readonly to: IsoDate
  readonly netProfit: Money
  /** Starts from net profit; `total` includes it. */
  readonly operating: CashFlowSection
  readonly investing: CashFlowSection
  readonly financing: CashFlowSection
  readonly netChange: Money
  readonly openingCash: Money
  readonly closingCash: Money
  /** Zero for a balanced ledger; shown if it ever isn't. */
  readonly difference: Money
  readonly previous?: Omit<CashFlowStatement, "previous">
}

export const journalSourceTypeSchema = z.enum([
  "manual",
  "razorpay",
  "bank",
  "invoice",
  "bill",
  "inbox",
  "reversal",
  "opening_balance",
  "credit_note",
])

export const listEntriesFiltersSchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    /** Drill down from a report row: entries with a line on this account. */
    accountId: idSchema.optional(),
    /** Entries with a line for this party (with `accountId`: the same line). */
    partyId: idSchema.optional(),
    sourceType: journalSourceTypeSchema.optional(),
    /** Narration contains this text (case-insensitive). */
    search: z.string().trim().min(1).max(100).optional(),
    /** Newest first (the default) or oldest first (the day book). */
    order: z.enum(["newest", "oldest"]).optional(),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, "'from' is after 'to'")
export type ListEntriesFilters = z.input<typeof listEntriesFiltersSchema>

// ---------------------------------------------------------------------------
// Revenue breakdown and cash position

export interface RevenueByCustomer {
  readonly party: PartyRef
  /** Invoices dated in the range (credit notes are netted, not counted). */
  readonly invoiceCount: number
  /** Taxable value invoiced minus credited in the range (excludes GST). */
  readonly revenue: Money
}

export interface RevenueByStream {
  /** An income account under revenue from operations. */
  readonly accountId: string
  readonly code: string
  readonly name: string
  readonly revenue: Money
}

export interface RevenueBreakdown {
  readonly from: IsoDate
  readonly to: IsoDate
  /** Revenue from operations in the books for the range (as in the P&L). */
  readonly total: Money
  /** Customers by revenue, highest first; paged with `nextCursor`. */
  readonly byCustomer: readonly RevenueByCustomer[]
  readonly nextCursor: string | null
  /**
   * Revenue with no customer: payments without an invoice (rule 8) and
   * manual entries. total = all customers + this.
   */
  readonly withoutCustomer: Money
  readonly byStream: readonly RevenueByStream[]
}

export interface CashLineStats {
  readonly count: number
  /** Net of the lines: money in positive, money out negative. */
  readonly amount: Money
}

export interface CashAccountPosition {
  readonly accountId: string
  readonly code: string
  readonly name: string
  readonly kind: "bank" | "razorpay" | "cash"
  readonly bankName: string | null
  readonly accountLast4: string | null
  /** Book balance as of the date; negative for an overdraft. */
  readonly balance: Money
  /** Latest bank-statement line (bank) or settlement (Razorpay) imported, IST date. */
  readonly lastStatementDate: IsoDate | null
  readonly lastSyncedAt: IsoTimestamp | null
  /** Statement lines booked by a match or approval. */
  readonly matched: CashLineStats
  /** Statement lines waiting in the inbox. */
  readonly unmatched: CashLineStats
}

export interface CashPosition {
  readonly asOf: IsoDate
  /**
   * Cash in bank and in hand: the sum of the "bank" and "cash" balances
   * below. The "razorpay" row is in `heldByRazorpay`, not here.
   */
  readonly total: Money
  /** The Razorpay clearing balance: collected by Razorpay, not yet settled. */
  readonly heldByRazorpay: Money
  readonly accounts: readonly CashAccountPosition[]
}

// ---------------------------------------------------------------------------
// Day book and ledgers

export const dateRangeSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((r) => r.from <= r.to, {
    message: "'from' is after 'to'.",
    path: ["from"],
  })
export type DateRange = z.input<typeof dateRangeSchema>

/** Every entry in a date range, oldest first, with the range's totals. */
export interface DayBook {
  readonly from: IsoDate
  readonly to: IsoDate
  /** Across the whole range, not just this page. Equal for a balanced ledger. */
  readonly totalDebit: Money
  readonly totalCredit: Money
  readonly entries: {
    readonly items: readonly JournalEntryView[]
    readonly nextCursor: string | null
  }
}

/** A ledger for one account, one party, or one party on one account. */
export const ledgerScopeSchema = z
  .object({ accountId: idSchema.optional(), partyId: idSchema.optional() })
  .refine((s) => s.accountId || s.partyId, {
    message: "Choose an account or a customer or vendor.",
  })
export type LedgerScope = z.input<typeof ledgerScopeSchema>

export interface LedgerLine {
  readonly date: IsoDate
  readonly entryId: string
  readonly narration: string
  readonly account: {
    readonly id: string
    readonly code: string
    readonly name: string
  }
  readonly party: PartyRef | null
  readonly debit: Money
  readonly credit: Money
  /** Running balance after this line: debit − credit (negative = credit). */
  readonly balance: Money
}

/**
 * Ledger lines in date order with opening, running and closing balances
 * (debit − credit). Keyset-paged: each page opens where the last closed.
 */
export interface Ledger {
  readonly account: {
    readonly id: string
    readonly code: string
    readonly name: string
    readonly type: AccountType
  } | null
  readonly party: PartyRef | null
  readonly from: IsoDate
  readonly to: IsoDate
  readonly opening: Money
  readonly lines: readonly LedgerLine[]
  readonly closing: Money
  readonly nextCursor: string | null
}
