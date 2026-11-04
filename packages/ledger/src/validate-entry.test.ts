import { describe, expect, it } from "vitest"

import { InvalidMoneyError, paise } from "./money.js"
import type { Money } from "./money.js"
import type { JournalLine } from "./types.js"
import { validateEntry } from "./validate-entry.js"

const dr = (accountId: string, amount: bigint): JournalLine => ({
  accountId,
  debit: paise(amount),
  credit: paise(0n),
})
const cr = (accountId: string, amount: bigint): JournalLine => ({
  accountId,
  debit: paise(0n),
  credit: paise(amount),
})

/** Simulates a float leaking in from JSON, CSV or AI output at runtime. */
function leakedFloat(value: number): Money {
  const untyped: unknown = value
  return untyped as Money
}

describe("validateEntry: debits must equal credits", () => {
  it("accepts a balanced entry", () => {
    const result = validateEntry({
      lines: [dr("cash", 118_000n), cr("sales", 100_000n), cr("gst", 18_000n)],
    })
    expect(result).toEqual({
      ok: true,
      totalDebit: 118_000n,
      totalCredit: 118_000n,
    })
  })

  it("rejects an entry where debits exceed credits", () => {
    const result = validateEntry({
      lines: [dr("cash", 100_001n), cr("sales", 100_000n)],
    })
    expect(result).toEqual({
      ok: false,
      errors: [
        { code: "UNBALANCED", totalDebit: 100_001n, totalCredit: 100_000n },
      ],
    })
  })

  it("rejects an entry where credits exceed debits", () => {
    const result = validateEntry({
      lines: [dr("cash", 50n), cr("sales", 75n)],
    })
    expect(result.ok).toBe(false)
  })

  it("rejects an entry with no lines", () => {
    expect(validateEntry({ lines: [] })).toEqual({
      ok: false,
      errors: [{ code: "NO_LINES" }],
    })
  })

  it("balances amounts beyond Number.MAX_SAFE_INTEGER exactly", () => {
    const big = 9_007_199_254_740_993n // MAX_SAFE_INTEGER + 2
    const result = validateEntry({ lines: [dr("a", big), cr("b", big)] })
    expect(result.ok).toBe(true)
  })
})

describe("validateEntry: amounts must be integer paise", () => {
  it("rejects a float debit", () => {
    const result = validateEntry({
      lines: [
        { accountId: "cash", debit: leakedFloat(100.5), credit: paise(0n) },
        cr("sales", 100n),
      ],
    })
    expect(result).toEqual({
      ok: false,
      errors: [{ code: "NON_INTEGER_AMOUNT", lineIndex: 0, field: "debit" }],
    })
  })

  it("rejects a float credit", () => {
    const result = validateEntry({
      lines: [
        dr("cash", 10n),
        { accountId: "sales", debit: paise(0n), credit: leakedFloat(0.1) },
      ],
    })
    expect(result).toEqual({
      ok: false,
      errors: [{ code: "NON_INTEGER_AMOUNT", lineIndex: 1, field: "credit" }],
    })
  })

  it("paise() refuses to construct Money from a non-integer number", () => {
    expect(() => paise(10.25)).toThrow(InvalidMoneyError)
    expect(() => paise(Number.NaN)).toThrow(InvalidMoneyError)
    expect(() => paise(Number.MAX_SAFE_INTEGER + 1)).toThrow(InvalidMoneyError)
    expect(paise(1050)).toBe(1050n)
  })

  it("rejects negative amounts and two-sided lines", () => {
    const result = validateEntry({
      lines: [
        { accountId: "a", debit: paise(-5n), credit: paise(0n) },
        { accountId: "b", debit: paise(5n), credit: paise(5n) },
      ],
    })
    expect(result).toEqual({
      ok: false,
      errors: [
        { code: "NEGATIVE_AMOUNT", lineIndex: 0 },
        { code: "LINE_NOT_ONE_SIDED", lineIndex: 1 },
      ],
    })
  })
})
