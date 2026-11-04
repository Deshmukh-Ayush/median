import { ZERO, addMoney } from "./money.js"
import type { Money } from "./money.js"
import type { JournalEntry } from "./types.js"

export type EntryValidationError =
  | { readonly code: "NO_LINES" }
  | {
      readonly code: "NON_INTEGER_AMOUNT"
      readonly lineIndex: number
      readonly field: "debit" | "credit"
    }
  | { readonly code: "NEGATIVE_AMOUNT"; readonly lineIndex: number }
  | { readonly code: "LINE_NOT_ONE_SIDED"; readonly lineIndex: number }
  | {
      readonly code: "UNBALANCED"
      readonly totalDebit: Money
      readonly totalCredit: Money
    }

export type EntryValidationResult =
  | {
      readonly ok: true
      readonly totalDebit: Money
      readonly totalCredit: Money
    }
  | { readonly ok: false; readonly errors: readonly EntryValidationError[] }

/**
 * Checks the double-entry invariants of a journal entry:
 * - every amount is an integer number of paise (no floats sneaking in from
 *   JSON, CSV or AI output),
 * - each line is non-negative and one-sided (debit xor credit),
 * - total debits equal total credits.
 *
 * Pure function: no I/O, no clock, no framework.
 */
export function validateEntry(
  entry: Pick<JournalEntry, "lines">
): EntryValidationResult {
  if (entry.lines.length === 0) {
    return { ok: false, errors: [{ code: "NO_LINES" }] }
  }

  const errors: EntryValidationError[] = []
  let totalDebit = ZERO
  let totalCredit = ZERO

  entry.lines.forEach((line, lineIndex) => {
    // Values can reach this point from untyped sources at runtime, so check
    // the real runtime type instead of trusting the static `Money` type.
    const debit: unknown = line.debit
    const credit: unknown = line.credit
    let amountsValid = true

    if (typeof debit !== "bigint") {
      errors.push({ code: "NON_INTEGER_AMOUNT", lineIndex, field: "debit" })
      amountsValid = false
    }
    if (typeof credit !== "bigint") {
      errors.push({ code: "NON_INTEGER_AMOUNT", lineIndex, field: "credit" })
      amountsValid = false
    }
    if (!amountsValid) return

    if (line.debit < 0n || line.credit < 0n) {
      errors.push({ code: "NEGATIVE_AMOUNT", lineIndex })
      return
    }
    if ((line.debit === 0n) === (line.credit === 0n)) {
      errors.push({ code: "LINE_NOT_ONE_SIDED", lineIndex })
      return
    }

    totalDebit = addMoney(totalDebit, line.debit)
    totalCredit = addMoney(totalCredit, line.credit)
  })

  if (errors.length > 0) return { ok: false, errors }

  if (totalDebit !== totalCredit) {
    return {
      ok: false,
      errors: [{ code: "UNBALANCED", totalDebit, totalCredit }],
    }
  }

  return { ok: true, totalDebit, totalCredit }
}
