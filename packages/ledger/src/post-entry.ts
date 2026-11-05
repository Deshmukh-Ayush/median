import { validateEntry } from "./validate-entry"
import type { EntryValidationError } from "./validate-entry"
import type { Money } from "./money"
import type { JournalLine } from "./types"

/** An entry about to be posted. */
export interface EntryDraft {
  /** ISO calendar date (YYYY-MM-DD) the entry is effective on. */
  readonly date: string
  readonly narration: string
  readonly lines: readonly JournalLine[]
  /** Set when this entry reverses an earlier posted entry. */
  readonly reversesEntryId?: string | null
}

/** A posted entry, as needed to check or build its reversal. */
export interface PostedEntry {
  readonly id: string
  readonly date: string
  readonly lines: readonly JournalLine[]
  readonly reversesEntryId: string | null
}

/** What the caller knows about the books at posting time. */
export interface PostingContext {
  /** The organisation's locked periods (YYYY-MM). */
  readonly lockedPeriods: ReadonlySet<string>
  /**
   * Required when the draft reverses an entry: the original, loaded from the
   * same organisation, and whether a reversal of it already exists.
   */
  readonly original?: {
    readonly entry: PostedEntry
    readonly alreadyReversed: boolean
  } | null
}

export type PostingError =
  | EntryValidationError
  | { readonly code: "INVALID_DATE"; readonly date: string }
  | { readonly code: "EMPTY_NARRATION" }
  | { readonly code: "PERIOD_LOCKED"; readonly period: string }
  | { readonly code: "REVERSAL_ORIGINAL_MISSING" }
  | { readonly code: "ALREADY_REVERSED" }
  | { readonly code: "REVERSAL_OF_REVERSAL" }
  | { readonly code: "REVERSAL_BEFORE_ORIGINAL" }
  | { readonly code: "REVERSAL_MISMATCH" }

export type PostingResult =
  | {
      readonly ok: true
      readonly period: string
      readonly totalDebit: Money
      readonly totalCredit: Money
    }
  | { readonly ok: false; readonly errors: readonly PostingError[] }

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(date: string): boolean {
  const match = DATE_PATTERN.exec(date)
  if (!match) return false
  const [, y, m, d] = match.map(Number)
  if (y === undefined || m === undefined || d === undefined) return false
  const parsed = new Date(Date.UTC(y, m - 1, d))
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  )
}

/** The accounting period (YYYY-MM) a date falls in. */
export function periodOf(date: string): string {
  return date.slice(0, 7)
}

/** Order-independent fingerprint of an entry's lines. */
function lineKeys(lines: readonly JournalLine[]): string[] {
  return lines
    .map((l) =>
      [l.accountId, l.partyId ?? "", String(l.debit), String(l.credit)].join(
        "|"
      )
    )
    .sort()
}

function mirrorLines(lines: readonly JournalLine[]): JournalLine[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }))
}

/**
 * The rules every posting must pass. Pure: the caller loads the locked
 * periods and the original entry (for reversals) and passes them in.
 *
 * - debits equal credits, amounts are non-negative integer paise, lines are
 *   one-sided (see validateEntry);
 * - the date is a real date and its period isn't locked;
 * - a reversal exactly mirrors an existing, not-yet-reversed entry that is
 *   not itself a reversal, and is dated on or after it.
 *
 * Posted entries are never edited. To correct one, post its reversal (see
 * buildReversal) and then the corrected entry.
 */
export function checkPosting(
  draft: EntryDraft,
  context: PostingContext
): PostingResult {
  const errors: PostingError[] = []

  const validation = validateEntry(draft)
  if (!validation.ok) errors.push(...validation.errors)

  if (draft.narration.trim() === "") errors.push({ code: "EMPTY_NARRATION" })

  const dateValid = isIsoDate(draft.date)
  if (!dateValid) {
    errors.push({ code: "INVALID_DATE", date: draft.date })
  } else if (context.lockedPeriods.has(periodOf(draft.date))) {
    errors.push({ code: "PERIOD_LOCKED", period: periodOf(draft.date) })
  }

  if (draft.reversesEntryId) {
    const original = context.original
    if (!original || original.entry.id !== draft.reversesEntryId) {
      errors.push({ code: "REVERSAL_ORIGINAL_MISSING" })
    } else {
      if (original.alreadyReversed) errors.push({ code: "ALREADY_REVERSED" })
      if (original.entry.reversesEntryId) {
        errors.push({ code: "REVERSAL_OF_REVERSAL" })
      }
      if (dateValid && draft.date < original.entry.date) {
        errors.push({ code: "REVERSAL_BEFORE_ORIGINAL" })
      }
      const expected = lineKeys(mirrorLines(original.entry.lines))
      const actual = lineKeys(draft.lines)
      if (
        expected.length !== actual.length ||
        expected.some((key, i) => key !== actual[i])
      ) {
        errors.push({ code: "REVERSAL_MISMATCH" })
      }
    }
  }

  if (errors.length > 0 || !validation.ok) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    period: periodOf(draft.date),
    totalDebit: validation.totalDebit,
    totalCredit: validation.totalCredit,
  }
}

/**
 * The reversal of a posted entry: same lines with debits and credits
 * swapped. Post it with checkPosting like any other entry.
 */
export function buildReversal(
  original: PostedEntry,
  options: { readonly date: string; readonly narration?: string }
): EntryDraft {
  return {
    date: options.date,
    narration: options.narration ?? `Reversal of entry ${original.id}`,
    lines: mirrorLines(original.lines),
    reversesEntryId: original.id,
  }
}
