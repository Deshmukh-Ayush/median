import "server-only"

import {
  ServiceError,
  isoDateSchema,
  listEntriesFiltersSchema,
  pageOptionsSchema,
  parseInput,
} from "@workspace/contracts"
import type {
  BalanceSheet,
  CashFlowStatement,
  IsoDate,
  JournalEntryView,
  ListEntriesFilters,
  Page,
  PageOptions,
  ProfitAndLoss,
  ReportSection,
  TrialBalance,
} from "@workspace/contracts"
import {
  LINE_ITEM_LABELS,
  buildBalanceSheet,
  buildCashFlow,
  buildProfitAndLoss,
  buildTrialBalance,
  dayBefore,
  financialYearStart,
  paise,
  sameDayLastYear,
} from "@workspace/ledger"
import type { AccountTotals, StatementSectionResult } from "@workspace/ledger"
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm"
import type { AnyColumn } from "drizzle-orm"
import { z } from "zod"

import { getDb } from "../db"
import {
  journalEntries,
  journalLines,
  ledgerAccounts,
  parties,
} from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { decodeCursor, encodeCursor } from "./pagination"

// Reports read journal_lines only (entry_date is copied onto each line), so
// every statement is one aggregate over journal_lines_org_date_cover_idx, an
// index-only range scan, joined to the chart of accounts. The statements
// themselves are built by pure code in @workspace/ledger.

const rangeSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((r) => r.from <= r.to, "'from' is after 'to'")

type AccountKind = AccountTotals["type"]

/**
 * Debit and credit totals per account for lines dated in [from, to]
 * (`from` null: since the beginning), optionally only some account types.
 */
export function accountTotalsQuery(
  orgId: string,
  range: { from: IsoDate | null; to: IsoDate },
  types?: readonly AccountKind[]
) {
  const db = getDb()
  const sums = db
    .select({
      accountId: journalLines.accountId,
      debit: sql<string>`sum(${journalLines.debitPaise})::text`.as("debit"),
      credit: sql<string>`sum(${journalLines.creditPaise})::text`.as("credit"),
    })
    .from(journalLines)
    .where(
      and(
        eq(journalLines.organizationId, orgId),
        range.from ? gte(journalLines.entryDate, range.from) : undefined,
        lte(journalLines.entryDate, range.to)
      )
    )
    .groupBy(journalLines.accountId)
    .as("sums")
  return db
    .select({
      accountId: ledgerAccounts.id,
      code: ledgerAccounts.code,
      name: ledgerAccounts.name,
      type: ledgerAccounts.type,
      systemKey: ledgerAccounts.systemKey,
      isBank: ledgerAccounts.isBank,
      debit: sums.debit,
      credit: sums.credit,
    })
    .from(sums)
    .innerJoin(
      ledgerAccounts,
      and(
        eq(ledgerAccounts.organizationId, orgId),
        eq(ledgerAccounts.id, sums.accountId),
        types ? inArray(ledgerAccounts.type, [...types]) : undefined
      )
    )
}

export interface AccountTotalsRow extends AccountTotals {
  readonly systemKey: string | null
  readonly isBank: boolean
}

export function toAccountTotals(
  rows: readonly {
    accountId: string
    code: string
    name: string
    type: AccountKind
    systemKey: string | null
    isBank: boolean
    debit: string
    credit: string
  }[]
): AccountTotalsRow[] {
  return rows.map((r) => ({
    ...r,
    debit: paise(BigInt(r.debit)),
    credit: paise(BigInt(r.credit)),
  }))
}

function toSections(
  sections: readonly StatementSectionResult[]
): ReportSection[] {
  return sections.map((s) => ({
    ...s,
    rows: s.rows.map((r) => ({
      ...r,
      lineItemLabel: LINE_ITEM_LABELS[r.lineItem],
    })),
  }))
}

/** Closing balance of every account with lines up to `asOf`. */
export async function getTrialBalance(
  ctx: OrgContext,
  asOf: IsoDate
): Promise<TrialBalance> {
  assertCan(ctx, "report", "read")
  const date = parseInput(isoDateSchema, asOf)
  const rows = await accountTotalsQuery(ctx.orgId, { from: null, to: date })
  return { asOf: date, ...buildTrialBalance(toAccountTotals(rows)) }
}

const comparativeOptions = z.object({
  /** Include the same period a year earlier. Default true. */
  comparative: z.boolean().default(true),
})
type ComparativeOptions = z.input<typeof comparativeOptions>

function plFrom(
  r: { from: IsoDate; to: IsoDate },
  rows: Parameters<typeof toAccountTotals>[0]
): Omit<ProfitAndLoss, "previous"> {
  const pl = buildProfitAndLoss(toAccountTotals(rows))
  return {
    ...r,
    ...pl,
    income: toSections(pl.income),
    expenses: toSections(pl.expenses),
  }
}

/**
 * Profit and loss for a date range (inclusive), Schedule III grouping, with
 * the same range a year earlier as `previous` unless `comparative: false`.
 */
export async function getProfitAndLoss(
  ctx: OrgContext,
  from: IsoDate,
  to: IsoDate,
  options: ComparativeOptions = {}
): Promise<ProfitAndLoss> {
  assertCan(ctx, "report", "read")
  const r = parseInput(rangeSchema, { from, to })
  const { comparative } = parseInput(comparativeOptions, options)
  if (!comparative)
    return plFrom(
      r,
      await accountTotalsQuery(ctx.orgId, r, ["income", "expense"])
    )
  const prior = { from: sameDayLastYear(r.from), to: sameDayLastYear(r.to) }
  const db = getDb()
  const [current, previous] = await db.batch([
    accountTotalsQuery(ctx.orgId, r, ["income", "expense"]),
    accountTotalsQuery(ctx.orgId, prior, ["income", "expense"]),
  ])
  return { ...plFrom(r, current), previous: plFrom(prior, previous) }
}

async function balanceSheetQueries(orgId: string, dates: readonly IsoDate[]) {
  const db = getDb()
  const queries = dates.flatMap((date) => [
    accountTotalsQuery(orgId, { from: null, to: date }),
    accountTotalsQuery(orgId, { from: financialYearStart(date), to: date }, [
      "income",
      "expense",
    ]),
  ])
  const [first, ...rest] = queries
  if (!first) return []
  return db.batch([first, ...rest])
}

function bsFrom(
  asOf: IsoDate,
  cumulative: Parameters<typeof toAccountTotals>[0],
  currentYear: Parameters<typeof toAccountTotals>[0]
): Omit<BalanceSheet, "previous"> {
  const bs = buildBalanceSheet(
    toAccountTotals(cumulative),
    toAccountTotals(currentYear)
  )
  return {
    asOf,
    ...bs,
    equityAndLiabilities: toSections(bs.equityAndLiabilities),
    assets: toSections(bs.assets),
  }
}

/**
 * Balance sheet as of a date, Schedule III grouping, with the same day a
 * year earlier as `previous` unless `comparative: false`.
 */
export async function getBalanceSheet(
  ctx: OrgContext,
  asOf: IsoDate,
  options: ComparativeOptions = {}
): Promise<BalanceSheet> {
  assertCan(ctx, "report", "read")
  const date = parseInput(isoDateSchema, asOf)
  const { comparative } = parseInput(comparativeOptions, options)
  const prior = sameDayLastYear(date)
  const [cumulative, currentYear, priorCumulative, priorYear] =
    await balanceSheetQueries(ctx.orgId, comparative ? [date, prior] : [date])
  return {
    ...bsFrom(date, cumulative ?? [], currentYear ?? []),
    ...(comparative
      ? { previous: bsFrom(prior, priorCumulative ?? [], priorYear ?? []) }
      : {}),
  }
}

/** Cash flow over [from, to] from three aggregates over journal_lines. */
async function cashFlowFor(
  orgId: string,
  r: { from: IsoDate; to: IsoDate }
): Promise<Omit<CashFlowStatement, "previous">> {
  const db = getDb()
  const [opening, closing, period] = await db.batch([
    accountTotalsQuery(orgId, { from: null, to: dayBefore(r.from) }),
    accountTotalsQuery(orgId, { from: null, to: r.to }),
    accountTotalsQuery(orgId, r, ["income", "expense"]),
  ])
  return {
    ...r,
    ...buildCashFlow({
      opening: toAccountTotals(opening),
      closing: toAccountTotals(closing),
      period: toAccountTotals(period),
    }),
  }
}

/**
 * Cash flow statement for a date range, indirect method (AS 3), with the
 * same range a year earlier as `previous` unless `comparative: false`.
 */
export async function getCashFlowStatement(
  ctx: OrgContext,
  from: IsoDate,
  to: IsoDate,
  options: ComparativeOptions = {}
): Promise<CashFlowStatement> {
  assertCan(ctx, "report", "read")
  const r = parseInput(rangeSchema, { from, to })
  const { comparative } = parseInput(comparativeOptions, options)
  const prior = { from: sameDayLastYear(r.from), to: sameDayLastYear(r.to) }
  const [current, previous] = await Promise.all([
    cashFlowFor(ctx.orgId, r),
    comparative ? cashFlowFor(ctx.orgId, prior) : Promise.resolve(null),
  ])
  return { ...current, ...(previous ? { previous } : {}) }
}

/**
 * Journal entries, newest first (entry date, then id), with their lines.
 * With `accountId` or `partyId` the page is found from the lines (the
 * drill-down from a report row); otherwise from journal_entries. Either way
 * one query finds the page and one batch loads its lines and reversals.
 */
export async function listEntries(
  ctx: OrgContext,
  filters: ListEntriesFilters,
  cursor: string | null,
  options: PageOptions = {}
): Promise<Page<JournalEntryView>> {
  assertCan(ctx, "ledger", "read")
  const f = parseInput(listEntriesFiltersSchema, filters)
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = decodeCursor(cursor)
  if (after && !isoDateSchema.safeParse(after.k).success)
    throw new ServiceError("VALIDATION", "Invalid page cursor.")
  if (after && !z.uuid().safeParse(after.id).success)
    throw new ServiceError("VALIDATION", "Invalid page cursor.")

  const db = getDb()
  const e = journalEntries
  const entryFilters = [
    f.sourceType ? eq(e.sourceType, f.sourceType) : undefined,
    f.search
      ? ilike(e.narration, `%${f.search.replace(/[\\%_]/g, "\\$&")}%`)
      : undefined,
  ]
  // (date, id) < cursor, newest first.
  const keyset = (date: AnyColumn, id: AnyColumn) =>
    after
      ? sql`(${date}, ${id}) < (${after.k}::date, ${after.id}::uuid)`
      : undefined

  let page: { id: string; entryDate: string }[]
  if (f.accountId || f.partyId) {
    const l = journalLines
    page = await db
      .select({ id: l.entryId, entryDate: l.entryDate })
      .from(l)
      .innerJoin(
        e,
        and(eq(e.organizationId, l.organizationId), eq(e.id, l.entryId))
      )
      .where(
        and(
          eq(l.organizationId, ctx.orgId),
          f.accountId ? eq(l.accountId, f.accountId) : undefined,
          f.partyId ? eq(l.partyId, f.partyId) : undefined,
          f.from ? gte(l.entryDate, f.from) : undefined,
          f.to ? lte(l.entryDate, f.to) : undefined,
          keyset(l.entryDate, l.entryId),
          ...entryFilters
        )
      )
      // An entry can have several lines on the same account.
      .groupBy(l.entryDate, l.entryId)
      .orderBy(desc(l.entryDate), desc(l.entryId))
      .limit(limit + 1)
  } else {
    page = await db
      .select({ id: e.id, entryDate: e.entryDate })
      .from(e)
      .where(
        and(
          eq(e.organizationId, ctx.orgId),
          f.from ? gte(e.entryDate, f.from) : undefined,
          f.to ? lte(e.entryDate, f.to) : undefined,
          keyset(e.entryDate, e.id),
          ...entryFilters
        )
      )
      .orderBy(desc(e.entryDate), desc(e.id))
      .limit(limit + 1)
  }

  const shown = page.slice(0, limit)
  const last = shown.at(-1)
  return {
    items: await entryViews(
      ctx.orgId,
      shown.map((p) => p.id)
    ),
    nextCursor:
      page.length > limit && last
        ? encodeCursor({ k: last.entryDate, id: last.id })
        : null,
  }
}

/** Entries with their lines and reversal links, in the order of `ids`. */
export async function entryViews(
  orgId: string,
  ids: readonly string[]
): Promise<JournalEntryView[]> {
  if (ids.length === 0) return []
  const db = getDb()
  const [entries, lines, reversals] = await db.batch([
    db
      .select({
        id: journalEntries.id,
        entryDate: journalEntries.entryDate,
        narration: journalEntries.narration,
        sourceType: journalEntries.sourceType,
        sourceId: journalEntries.sourceId,
        reversesEntryId: journalEntries.reversesEntryId,
        createdBy: journalEntries.createdBy,
        createdAt: journalEntries.createdAt,
      })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.organizationId, orgId),
          inArray(journalEntries.id, [...ids])
        )
      ),
    db
      .select({
        id: journalLines.id,
        entryId: journalLines.entryId,
        accountId: ledgerAccounts.id,
        accountCode: ledgerAccounts.code,
        accountName: ledgerAccounts.name,
        accountType: ledgerAccounts.type,
        partyId: parties.id,
        partyName: parties.name,
        partyGstin: parties.gstin,
        debit: journalLines.debitPaise,
        credit: journalLines.creditPaise,
        description: journalLines.description,
      })
      .from(journalLines)
      .innerJoin(
        ledgerAccounts,
        and(
          eq(ledgerAccounts.organizationId, journalLines.organizationId),
          eq(ledgerAccounts.id, journalLines.accountId)
        )
      )
      .leftJoin(
        parties,
        and(
          eq(parties.organizationId, journalLines.organizationId),
          eq(parties.id, journalLines.partyId)
        )
      )
      .where(
        and(
          eq(journalLines.organizationId, orgId),
          inArray(journalLines.entryId, [...ids])
        )
      )
      .orderBy(asc(journalLines.entryId), asc(journalLines.lineNo)),
    db
      .select({
        id: journalEntries.id,
        reversesEntryId: journalEntries.reversesEntryId,
      })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.organizationId, orgId),
          inArray(journalEntries.reversesEntryId, [...ids])
        )
      ),
  ])

  const reversedBy = new Map(
    reversals.flatMap((r) =>
      r.reversesEntryId ? [[r.reversesEntryId, r.id]] : []
    )
  )
  const linesBy = new Map<string, JournalEntryView["lines"][number][]>()
  for (const l of lines) {
    const list = linesBy.get(l.entryId) ?? []
    list.push({
      id: l.id,
      account: {
        id: l.accountId,
        code: l.accountCode,
        name: l.accountName,
        type: l.accountType,
      },
      party: l.partyId
        ? { id: l.partyId, name: l.partyName ?? "", gstin: l.partyGstin }
        : null,
      debit: paise(l.debit),
      credit: paise(l.credit),
      description: l.description,
    })
    linesBy.set(l.entryId, list)
  }
  const byId = new Map(entries.map((x) => [x.id, x]))
  return ids.flatMap((id) => {
    const x = byId.get(id)
    if (!x) return []
    const own = linesBy.get(id) ?? []
    return [
      {
        ...x,
        createdAt: x.createdAt.toISOString(),
        reversedByEntryId: reversedBy.get(id) ?? null,
        lines: own,
        total: paise(own.reduce((s, l) => s + l.debit, 0n)),
      },
    ]
  })
}
