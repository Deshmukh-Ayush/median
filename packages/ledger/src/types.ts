import type { Money } from "./money"

export type AccountType =
  "asset" | "liability" | "equity" | "income" | "expense"

export interface Account {
  readonly id: string
  readonly organizationId: string
  readonly code: string
  readonly name: string
  readonly type: AccountType
}

/**
 * One side of a journal entry. Exactly one of `debit` / `credit` is a positive
 * amount; the other is zero.
 */
export interface JournalLine {
  readonly accountId: string
  /** Customer or vendor the line relates to (receivables, payables). */
  readonly partyId?: string | null
  readonly debit: Money
  readonly credit: Money
  readonly description?: string
}

export type JournalEntryStatus = "draft" | "posted"

export interface JournalEntry {
  readonly id: string
  readonly organizationId: string
  /** ISO calendar date (YYYY-MM-DD) the entry is effective on. */
  readonly date: string
  readonly narration: string
  readonly status: JournalEntryStatus
  readonly lines: readonly JournalLine[]
  /** Set when this entry reverses an earlier posted entry. */
  readonly reversesEntryId?: string
}
