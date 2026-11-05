import { describe, expect, it } from "vitest"

import { paise } from "./money"
import type { Money } from "./money"
import { buildReversal, checkPosting, isIsoDate } from "./post-entry"
import type { EntryDraft, PostedEntry, PostingContext } from "./post-entry"
import type { JournalLine } from "./types"

const dr = (
  accountId: string,
  amount: bigint,
  partyId?: string
): JournalLine => ({
  accountId,
  partyId: partyId ?? null,
  debit: paise(amount),
  credit: paise(0n),
})
const cr = (
  accountId: string,
  amount: bigint,
  partyId?: string
): JournalLine => ({
  accountId,
  partyId: partyId ?? null,
  debit: paise(0n),
  credit: paise(amount),
})

const open: PostingContext = { lockedPeriods: new Set() }

const invoice: EntryDraft = {
  date: "2026-10-15",
  narration: "Invoice INV/2026-27/0001",
  lines: [
    dr("receivables", 118_000_00n, "acme"),
    cr("revenue", 100_000_00n),
    cr("cgst", 9_000_00n),
    cr("sgst", 9_000_00n),
  ],
}

const posted: PostedEntry = {
  id: "entry-1",
  date: invoice.date,
  lines: invoice.lines,
  reversesEntryId: null,
}

const codes = (result: ReturnType<typeof checkPosting>) =>
  result.ok ? [] : result.errors.map((e) => e.code)

describe("checkPosting: balanced", () => {
  it("accepts a balanced entry and returns its period", () => {
    expect(checkPosting(invoice, open)).toEqual({
      ok: true,
      period: "2026-10",
      totalDebit: 118_000_00n,
      totalCredit: 118_000_00n,
    })
  })

  it("rejects an unbalanced entry", () => {
    const result = checkPosting(
      { ...invoice, lines: [dr("bank", 100n), cr("revenue", 99n)] },
      open
    )
    expect(codes(result)).toEqual(["UNBALANCED"])
  })

  it("rejects an entry with no lines", () => {
    expect(codes(checkPosting({ ...invoice, lines: [] }, open))).toEqual([
      "NO_LINES",
    ])
  })
})

describe("checkPosting: integer paise", () => {
  it("rejects a float amount that slipped past the type system", () => {
    const float: unknown = 10.5
    const result = checkPosting(
      {
        ...invoice,
        lines: [
          { accountId: "bank", debit: float as Money, credit: paise(0n) },
          cr("revenue", 10n),
        ],
      },
      open
    )
    expect(codes(result)).toEqual(["NON_INTEGER_AMOUNT"])
  })

  it("rejects negative and two-sided lines", () => {
    const result = checkPosting(
      {
        ...invoice,
        lines: [
          { accountId: "a", debit: paise(-1n), credit: paise(0n) },
          { accountId: "b", debit: paise(1n), credit: paise(1n) },
        ],
      },
      open
    )
    expect(codes(result)).toEqual(["NEGATIVE_AMOUNT", "LINE_NOT_ONE_SIDED"])
  })
})

describe("checkPosting: dates and narration", () => {
  it("rejects impossible dates", () => {
    for (const date of ["2026-02-30", "2026-13-01", "15-10-2026", ""]) {
      expect(codes(checkPosting({ ...invoice, date }, open)), date).toEqual([
        "INVALID_DATE",
      ])
    }
  })

  it("accepts a leap day", () => {
    expect(isIsoDate("2028-02-29")).toBe(true)
    expect(isIsoDate("2027-02-29")).toBe(false)
  })

  it("rejects a blank narration", () => {
    expect(codes(checkPosting({ ...invoice, narration: "  " }, open))).toEqual([
      "EMPTY_NARRATION",
    ])
  })
})

describe("checkPosting: locked periods", () => {
  const locked: PostingContext = { lockedPeriods: new Set(["2026-10"]) }

  it("rejects posting into a locked period", () => {
    expect(checkPosting(invoice, locked)).toEqual({
      ok: false,
      errors: [{ code: "PERIOD_LOCKED", period: "2026-10" }],
    })
  })

  it("allows the next, open period", () => {
    expect(checkPosting({ ...invoice, date: "2026-11-01" }, locked).ok).toBe(
      true
    )
  })

  it("rejects a reversal dated in a locked period", () => {
    const reversal = buildReversal(posted, { date: "2026-10-31" })
    const result = checkPosting(reversal, {
      ...locked,
      original: { entry: posted, alreadyReversed: false },
    })
    expect(codes(result)).toEqual(["PERIOD_LOCKED"])
  })

  it("lets a locked-period entry be corrected by a reversal in an open period", () => {
    const reversal = buildReversal(posted, { date: "2026-11-02" })
    const result = checkPosting(reversal, {
      ...locked,
      original: { entry: posted, alreadyReversed: false },
    })
    expect(result.ok).toBe(true)
  })
})

describe("checkPosting: corrections only by reversal", () => {
  const withOriginal = (alreadyReversed = false): PostingContext => ({
    lockedPeriods: new Set(),
    original: { entry: posted, alreadyReversed },
  })

  it("builds a reversal that mirrors the original", () => {
    const reversal = buildReversal(posted, { date: "2026-10-20" })
    expect(reversal.reversesEntryId).toBe("entry-1")
    expect(reversal.lines).toEqual([
      cr("receivables", 118_000_00n, "acme"),
      dr("revenue", 100_000_00n),
      dr("cgst", 9_000_00n),
      dr("sgst", 9_000_00n),
    ])
    expect(checkPosting(reversal, withOriginal()).ok).toBe(true)
  })

  it("accepts the mirrored lines in any order", () => {
    const reversal = buildReversal(posted, { date: "2026-10-20" })
    const shuffled = { ...reversal, lines: [...reversal.lines].reverse() }
    expect(checkPosting(shuffled, withOriginal()).ok).toBe(true)
  })

  it("rejects a 'reversal' that changes the amounts (an edit in disguise)", () => {
    const edited: EntryDraft = {
      date: "2026-10-20",
      narration: "Fix invoice",
      reversesEntryId: "entry-1",
      lines: [
        cr("receivables", 100_000_00n, "acme"),
        dr("revenue", 100_000_00n),
      ],
    }
    expect(codes(checkPosting(edited, withOriginal()))).toEqual([
      "REVERSAL_MISMATCH",
    ])
  })

  it("rejects a reversal that moves a line to another party", () => {
    const reversal = buildReversal(posted, { date: "2026-10-20" })
    const moved = {
      ...reversal,
      lines: reversal.lines.map((l) =>
        l.accountId === "receivables" ? { ...l, partyId: "zenith" } : l
      ),
    }
    expect(codes(checkPosting(moved, withOriginal()))).toEqual([
      "REVERSAL_MISMATCH",
    ])
  })

  it("rejects reversing an entry twice", () => {
    const reversal = buildReversal(posted, { date: "2026-10-20" })
    expect(codes(checkPosting(reversal, withOriginal(true)))).toEqual([
      "ALREADY_REVERSED",
    ])
  })

  it("rejects reversing a reversal", () => {
    const firstReversal: PostedEntry = {
      id: "entry-2",
      date: "2026-10-20",
      lines: buildReversal(posted, { date: "2026-10-20" }).lines,
      reversesEntryId: "entry-1",
    }
    const result = checkPosting(
      buildReversal(firstReversal, { date: "2026-10-21" }),
      {
        lockedPeriods: new Set(),
        original: { entry: firstReversal, alreadyReversed: false },
      }
    )
    expect(codes(result)).toEqual(["REVERSAL_OF_REVERSAL"])
  })

  it("rejects a reversal dated before the original", () => {
    const reversal = buildReversal(posted, { date: "2026-10-14" })
    expect(codes(checkPosting(reversal, withOriginal()))).toEqual([
      "REVERSAL_BEFORE_ORIGINAL",
    ])
  })

  it("rejects a reversal when the original wasn't loaded or doesn't match", () => {
    const reversal = buildReversal(posted, { date: "2026-10-20" })
    expect(codes(checkPosting(reversal, open))).toEqual([
      "REVERSAL_ORIGINAL_MISSING",
    ])
    expect(
      codes(
        checkPosting(
          { ...reversal, reversesEntryId: "entry-9" },
          withOriginal()
        )
      )
    ).toEqual(["REVERSAL_ORIGINAL_MISSING"])
  })
})
