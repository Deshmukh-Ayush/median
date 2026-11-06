import type { ProposedEntry, ProposedLine } from "@workspace/contracts"
import { paise } from "@workspace/ledger"
import { describe, expect, it } from "vitest"

import { applyInboxEdits } from "./inbox-edits"

const accounts = {
  outputCgst: "out_cgst",
  outputSgst: "out_sgst",
  outputIgst: "out_igst",
  inputCgst: "in_cgst",
  inputSgst: "in_sgst",
  inputIgst: "in_igst",
  tdsReceivable: "tds",
  receivables: "receivables",
}
const line = (
  accountId: string,
  debit: bigint,
  credit: bigint,
  partyId: string | null = null
): ProposedLine => ({
  accountId,
  partyId,
  debit: paise(debit),
  credit: paise(credit),
  description: null,
})
const summary = (entry: ProposedEntry) => {
  const dr = entry.lines.reduce((s, l) => s + l.debit, 0n)
  const cr = entry.lines.reduce((s, l) => s + l.credit, 0n)
  expect(dr).toBe(cr)
  return entry.lines.map((l) => [
    l.accountId,
    l.debit > 0n ? BigInt(l.debit) : -BigInt(l.credit),
  ])
}

describe("inbox edits", () => {
  const bill: ProposedEntry = {
    entryDate: "2026-11-01",
    narration: "AWS bill",
    lines: [
      line("hosting", 100_000n, 0n),
      line("in_cgst", 9_000n, 0n),
      line("in_sgst", 9_000n, 0n),
      line("payables", 0n, 118_000n, "aws"),
    ],
  }
  const gst = {
    taxable: paise(100_000n),
    cgst: paise(9_000n),
    sgst: paise(9_000n),
    igst: paise(0n),
    rateBps: 1800,
    supplyType: "intrastate" as const,
  }

  it("rebuilds input tax lines from a GST edit (intrastate → IGST)", () => {
    const { entry, gst: next } = applyInboxEdits(
      bill,
      { gst, tds: null },
      {
        gst: {
          taxable: paise(100_000n),
          cgst: paise(0n),
          sgst: paise(0n),
          igst: paise(18_000n),
        },
      },
      accounts
    )
    expect(summary(entry)).toEqual([
      ["hosting", 100_000n],
      ["in_igst", 18_000n],
      ["payables", -118_000n],
    ])
    expect(next?.supplyType).toBe("interstate")
  })

  it("leaves balance to the ledger when the total no longer matches", () => {
    const { entry } = applyInboxEdits(
      bill,
      { gst, tds: null },
      {
        gst: {
          taxable: paise(100_000n),
          cgst: paise(2_500n),
          sgst: paise(2_500n),
          igst: paise(0n),
        },
      },
      accounts
    )
    const dr = entry.lines.reduce((s, l) => s + l.debit, 0n)
    expect(dr).toBe(105_000n)
  })

  it("adds, changes and removes TDS against the receivable", () => {
    const receipt: ProposedEntry = {
      entryDate: "2026-11-01",
      narration: "Receipt",
      lines: [
        line("bank", 116_000n, 0n),
        line("tds", 2_000n, 0n, "acme"),
        line("receivables", 0n, 118_000n, "acme"),
      ],
    }
    const tds = {
      section: "194J" as const,
      rateBps: 200,
      amount: paise(2_000n),
    }
    const removed = applyInboxEdits(
      receipt,
      { gst: null, tds },
      { tds: null },
      accounts
    )
    expect(summary(removed.entry)).toEqual([
      ["bank", 116_000n],
      ["receivables", -116_000n],
    ])
    expect(removed.tds).toBeNull()
    const changed = applyInboxEdits(
      receipt,
      { gst: null, tds },
      { tds: { section: "194C", rateBps: 100, amount: paise(1_000n) } },
      accounts
    )
    expect(summary(changed.entry)).toEqual([
      ["bank", 116_000n],
      ["receivables", -117_000n],
      ["tds", 1_000n],
    ])
    expect(
      changed.entry.lines.find((l) => l.accountId === "tds")?.partyId
    ).toBe("acme")
  })

  it("applies date and narration edits, and rejects TDS without a receivable", () => {
    const { entry } = applyInboxEdits(
      bill,
      { gst, tds: null },
      { entryDate: "2026-11-05", narration: "Fixed" },
      accounts
    )
    expect([entry.entryDate, entry.narration]).toEqual(["2026-11-05", "Fixed"])
    expect(() =>
      applyInboxEdits(
        bill,
        { gst, tds: null },
        { tds: { section: "194C", rateBps: 100, amount: paise(1n) } },
        accounts
      )
    ).toThrow("TDS applies to receipts")
  })
})
