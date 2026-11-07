import "server-only"

import {
  ServiceError,
  idSchema,
  isoDateSchema,
  moneySchema,
  parseInput,
} from "@workspace/contracts"
import type { IsoDate, Money } from "@workspace/contracts"
import { buildReversal, checkPosting, paise, periodOf } from "@workspace/ledger"
import type { EntryDraft, PostedEntry, PostingError } from "@workspace/ledger"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import { withTransaction } from "../db"
import type { Tx } from "../db"
import {
  auditLog,
  journalEntries,
  journalLines,
  ledgerAccounts,
  parties,
  periodLocks,
} from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { isUniqueViolation } from "./db-errors"

/**
 * Who is posting. `userId` is null when a deterministic rule posts on its
 * own (Razorpay sync, bank matching); `source` then names the rule.
 */
export interface LedgerActor {
  readonly orgId: string
  readonly userId: string | null
  /** e.g. "web", "inbox", "invoice", "razorpay_rule", "bank_match" */
  readonly source: string
}

export const postEntryInputSchema = z.object({
  entryDate: isoDateSchema,
  narration: z.string().trim().min(1).max(500),
  sourceType: z.enum([
    "manual",
    "razorpay",
    "bank",
    "invoice",
    "bill",
    "inbox",
    "reversal",
    "opening_balance",
    "credit_note",
  ]),
  sourceId: z.string().max(100).nullish(),
  reversesEntryId: idSchema.nullish(),
  lines: z
    .array(
      z.object({
        accountId: idSchema,
        partyId: idSchema.nullish(),
        debit: moneySchema,
        credit: moneySchema,
        description: z.string().trim().max(500).nullish(),
        dimensions: z.record(z.string(), z.string()).nullish(),
      })
    )
    .min(1)
    .max(500),
})
export type PostEntryInput = z.input<typeof postEntryInputSchema>

export interface PostedEntryResult {
  readonly id: string
  readonly entryDate: IsoDate
  readonly period: string
  readonly total: Money
}

const POSTING_MESSAGES: Record<PostingError["code"], string> = {
  NO_LINES: "An entry needs at least one line.",
  NON_INTEGER_AMOUNT: "Amounts must be whole paise.",
  NEGATIVE_AMOUNT: "Amounts can't be negative.",
  LINE_NOT_ONE_SIDED: "Each line is either a debit or a credit, not both.",
  UNBALANCED: "Debits and credits don't balance.",
  INVALID_DATE: "That isn't a valid date.",
  EMPTY_NARRATION: "Add a narration.",
  PERIOD_LOCKED:
    "That period is locked. Post the correction in an open period.",
  REVERSAL_ORIGINAL_MISSING: "The entry being reversed doesn't exist.",
  ALREADY_REVERSED: "That entry has already been reversed.",
  REVERSAL_OF_REVERSAL:
    "A reversal can't be reversed. Post the original again.",
  REVERSAL_BEFORE_ORIGINAL: "A reversal can't be dated before the original.",
  REVERSAL_MISMATCH: "A reversal must exactly mirror the original entry.",
}

function postingError(errors: readonly PostingError[]): ServiceError {
  const first = errors[0]
  const code = first?.code ?? "UNBALANCED"
  const serviceCode =
    code === "PERIOD_LOCKED"
      ? "PERIOD_LOCKED"
      : code === "UNBALANCED"
        ? "UNBALANCED"
        : code === "ALREADY_REVERSED"
          ? "CONFLICT"
          : "VALIDATION"
  // bigints in error details can't be serialised; stringify them.
  const details = errors.map((e) =>
    "totalDebit" in e
      ? {
          ...e,
          totalDebit: String(e.totalDebit),
          totalCredit: String(e.totalCredit),
        }
      : e
  )
  return new ServiceError(serviceCode, POSTING_MESSAGES[code], details)
}

/** Postgres advisory-lock key for one organisation's period. */
function periodLockKey(orgId: string, period: string) {
  return sql`hashtextextended(${`${orgId}:${period}`}, 0)`
}

/**
 * Takes the period's advisory lock: shared for posting, exclusive for
 * locking, so a post and a lock on the same period can't interleave.
 * Released at the end of the transaction.
 */
export async function lockPeriodForPosting(
  tx: Tx,
  orgId: string,
  period: string,
  mode: "post" | "lock"
): Promise<void> {
  const key = periodLockKey(orgId, period)
  await tx.execute(
    mode === "post"
      ? sql`select pg_advisory_xact_lock_shared(${key})`
      : sql`select pg_advisory_xact_lock(${key})`
  )
}

async function loadOriginal(
  tx: Tx,
  orgId: string,
  entryId: string
): Promise<{ entry: PostedEntry; alreadyReversed: boolean } | null> {
  const [row] = await tx
    .select({
      id: journalEntries.id,
      entryDate: journalEntries.entryDate,
      reversesEntryId: journalEntries.reversesEntryId,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.organizationId, orgId),
        eq(journalEntries.id, entryId)
      )
    )
    .for("update")
  if (!row) return null

  const [lines, reversals] = await Promise.all([
    tx
      .select({
        accountId: journalLines.accountId,
        partyId: journalLines.partyId,
        debit: journalLines.debitPaise,
        credit: journalLines.creditPaise,
      })
      .from(journalLines)
      .where(
        and(
          eq(journalLines.organizationId, orgId),
          eq(journalLines.entryId, entryId)
        )
      )
      .orderBy(asc(journalLines.lineNo)),
    tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.organizationId, orgId),
          eq(journalEntries.reversesEntryId, entryId)
        )
      )
      .limit(1),
  ])

  return {
    entry: {
      id: row.id,
      date: row.entryDate,
      reversesEntryId: row.reversesEntryId,
      lines: lines.map((l) => ({
        ...l,
        debit: paise(l.debit),
        credit: paise(l.credit),
      })),
    },
    alreadyReversed: reversals.length > 0,
  }
}

async function assertReferencesExist(
  tx: Tx,
  orgId: string,
  accountIds: readonly string[],
  partyIds: readonly string[]
): Promise<void> {
  const [accounts, foundParties] = await Promise.all([
    tx
      .select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.organizationId, orgId),
          inArray(ledgerAccounts.id, [...accountIds])
        )
      ),
    partyIds.length === 0
      ? Promise.resolve([])
      : tx
          .select({ id: parties.id })
          .from(parties)
          .where(
            and(
              eq(parties.organizationId, orgId),
              inArray(parties.id, [...partyIds])
            )
          ),
  ])
  if (accounts.length !== accountIds.length) {
    throw new ServiceError(
      "VALIDATION",
      "One of the accounts doesn't exist in this organisation."
    )
  }
  if (foundParties.length !== partyIds.length) {
    throw new ServiceError(
      "VALIDATION",
      "One of the parties doesn't exist in this organisation."
    )
  }
}

/**
 * Posts a journal entry: checks every ledger rule (balanced, integer paise,
 * period not locked, reversals mirror an unreversed entry), then writes the
 * entry, its lines and an audit row in one transaction.
 *
 * Internal: other services call this (inbox approval, invoices, rules).
 * Pass `tx` to post inside a caller's transaction. Pages use
 * `postManualEntry` / `reverseEntry`, which check permissions.
 */
export async function postEntry(
  actor: LedgerActor,
  input: PostEntryInput,
  options: { readonly tx?: Tx } = {}
): Promise<PostedEntryResult> {
  const entry = parseInput(postEntryInputSchema, input)
  const run = (tx: Tx) => postInTransaction(tx, actor, entry)
  try {
    return await (options.tx ? run(options.tx) : withTransaction(run))
  } catch (error) {
    if (isUniqueViolation(error) && entry.reversesEntryId) {
      throw new ServiceError("CONFLICT", POSTING_MESSAGES.ALREADY_REVERSED)
    }
    throw error
  }
}

async function postInTransaction(
  tx: Tx,
  actor: LedgerActor,
  entry: z.output<typeof postEntryInputSchema>
): Promise<PostedEntryResult> {
  const { orgId } = actor
  const period = periodOf(entry.entryDate)

  await lockPeriodForPosting(tx, orgId, period, "post")

  const accountIds = [...new Set(entry.lines.map((l) => l.accountId))]
  const partyIds = [
    ...new Set(entry.lines.flatMap((l) => (l.partyId ? [l.partyId] : []))),
  ]

  const [locks, original] = await Promise.all([
    tx
      .select({ period: periodLocks.period })
      .from(periodLocks)
      .where(
        and(
          eq(periodLocks.organizationId, orgId),
          eq(periodLocks.period, period)
        )
      ),
    entry.reversesEntryId
      ? loadOriginal(tx, orgId, entry.reversesEntryId)
      : Promise.resolve(null),
    assertReferencesExist(tx, orgId, accountIds, partyIds),
  ])

  const draft: EntryDraft = {
    date: entry.entryDate,
    narration: entry.narration,
    reversesEntryId: entry.reversesEntryId ?? null,
    lines: entry.lines.map((l) => ({
      accountId: l.accountId,
      partyId: l.partyId ?? null,
      debit: l.debit,
      credit: l.credit,
    })),
  }
  const check = checkPosting(draft, {
    lockedPeriods: new Set(locks.map((l) => l.period)),
    original,
  })
  if (!check.ok) throw postingError(check.errors)

  const [created] = await tx
    .insert(journalEntries)
    .values({
      organizationId: orgId,
      entryDate: entry.entryDate,
      narration: entry.narration,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId ?? null,
      reversesEntryId: entry.reversesEntryId ?? null,
      createdBy: actor.userId,
    })
    .returning({ id: journalEntries.id, createdAt: journalEntries.createdAt })
  if (!created) throw new Error("Insert into journal_entries returned no row")

  await tx.insert(journalLines).values(
    entry.lines.map((l, lineNo) => ({
      organizationId: orgId,
      entryId: created.id,
      lineNo,
      entryDate: entry.entryDate,
      accountId: l.accountId,
      partyId: l.partyId ?? null,
      debitPaise: l.debit,
      creditPaise: l.credit,
      description: l.description ?? null,
      dimensions: l.dimensions ?? null,
    }))
  )

  await tx.insert(auditLog).values({
    organizationId: orgId,
    actorId: actor.userId,
    action: entry.reversesEntryId
      ? "journal_entry.reverse"
      : "journal_entry.post",
    entity: "journal_entry",
    entityId: created.id,
    before: null,
    after: {
      entryDate: entry.entryDate,
      narration: entry.narration,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId ?? null,
      reversesEntryId: entry.reversesEntryId ?? null,
      total: String(check.totalDebit),
      lines: entry.lines.map((l) => ({
        accountId: l.accountId,
        partyId: l.partyId ?? null,
        debit: String(l.debit),
        credit: String(l.credit),
      })),
    },
    source: actor.source,
    at: created.createdAt,
  })

  return {
    id: created.id,
    entryDate: entry.entryDate,
    period: check.period,
    total: check.totalDebit,
  }
}

const manualEntryInputSchema = postEntryInputSchema.omit({
  sourceType: true,
  sourceId: true,
  reversesEntryId: true,
})
export type ManualEntryInput = z.input<typeof manualEntryInputSchema>

/** A journal entry typed in by a user (finance team or CA). */
export async function postManualEntry(
  ctx: OrgContext,
  input: ManualEntryInput
): Promise<PostedEntryResult> {
  assertCan(ctx, "ledger", "post")
  const entry = parseInput(manualEntryInputSchema, input)
  return postEntry(
    { orgId: ctx.orgId, userId: ctx.userId, source: "web" },
    { ...entry, sourceType: "manual" }
  )
}

const reverseEntryInputSchema = z.object({
  entryId: idSchema,
  date: isoDateSchema,
  narration: z.string().trim().min(1).max(500).optional(),
})

/**
 * Reverses a posted entry with a mirror entry dated `date` (which must be in
 * an open period). The only way to correct the books.
 */
export async function reverseEntry(
  ctx: OrgContext,
  entryId: string,
  options: { readonly date: IsoDate; readonly narration?: string }
): Promise<PostedEntryResult> {
  assertCan(ctx, "ledger", "reverse")
  const r = parseInput(reverseEntryInputSchema, { entryId, ...options })
  const actor: LedgerActor = {
    orgId: ctx.orgId,
    userId: ctx.userId,
    source: "web",
  }
  try {
    return await withTransaction(async (tx) => {
      const original = await loadOriginal(tx, ctx.orgId, r.entryId)
      if (!original) throw new ServiceError("NOT_FOUND", "Entry not found.")
      const reversal = buildReversal(original.entry, {
        date: r.date,
        narration:
          r.narration ?? `Reversal of entry dated ${original.entry.date}`,
      })
      return postInTransaction(tx, actor, {
        entryDate: reversal.date,
        narration: reversal.narration,
        sourceType: "reversal",
        sourceId: r.entryId,
        reversesEntryId: r.entryId,
        lines: reversal.lines.map((l) => ({
          accountId: l.accountId,
          partyId: l.partyId ?? null,
          debit: l.debit,
          credit: l.credit,
          description: null,
          dimensions: null,
        })),
      })
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ServiceError("CONFLICT", POSTING_MESSAGES.ALREADY_REVERSED)
    }
    throw error
  }
}
