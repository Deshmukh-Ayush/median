/**
 * Field-level scoring for the bill-extraction eval. Deterministic: values are
 * normalised (case, spacing, digit grouping) and compared; amounts are parsed
 * to integer paise with the ledger's parser.
 */
import { parseRupees } from "@workspace/ledger"

import type { ReviewFlag } from "@/server/ai/bill-review"

import type { Expected } from "./fixtures"

type Kind = "text" | "code" | "amount" | "number" | "exact"

export interface FieldScore {
  /** Field key for aggregation, e.g. "lines[].hsnSac". */
  field: string
  /** Concrete path, e.g. "lines[2].hsnSac". */
  path: string
  expected: string | null
  actual: string | null
  correct: boolean
  /** Expected null (not printed) but the model returned a value. */
  invented: boolean
  flagged: boolean
}

const text = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
const code = (s: string) => s.toUpperCase().replace(/[\s-]/g, "")
const number = (s: string) => {
  const cleaned = s.replace(/[%\s,]/g, "")
  return cleaned.includes(".") ? cleaned.replace(/\.?0+$/, "") : cleaned
}

function amountEqual(a: string, b: string): boolean {
  try {
    return parseRupees(a) === parseRupees(b)
  } catch {
    return false
  }
}

function same(kind: Kind, expected: string, actual: string): boolean {
  switch (kind) {
    case "text":
      return text(expected) === text(actual)
    case "code":
      return code(expected) === code(actual)
    case "amount":
      return amountEqual(expected, actual)
    case "number":
      return number(expected) === number(actual)
    case "exact":
      return expected.trim() === actual.trim()
  }
}

function isFlagged(path: string, flags: ReviewFlag[]): boolean {
  // Accept "lines[0].x", "lines.0.x" and whole-object flags like "lines[0]".
  const norm = (p: string) => p.replace(/\.(\d+)/g, "[$1]").replace(/\s/g, "")
  const target = norm(path)
  return flags.some((f) => {
    const flag = norm(f.field)
    return (
      target === flag ||
      target.startsWith(`${flag}.`) ||
      target.startsWith(`${flag}[`)
    )
  })
}

const HEADER: [string, Kind, (e: Expected) => string | null][] = [
  ["vendor.name", "text", (e) => e.vendor.name],
  ["vendor.gstin", "code", (e) => e.vendor.gstin],
  ["billNumber", "code", (e) => e.billNumber],
  ["billDate", "exact", (e) => e.billDate],
  ["dueDate", "exact", (e) => e.dueDate],
  ["placeOfSupplyStateCode", "code", (e) => e.placeOfSupplyStateCode],
  ["printedTotals.taxable", "amount", (e) => e.printedTotals.taxable],
  ["printedTotals.cgst", "amount", (e) => e.printedTotals.cgst],
  ["printedTotals.sgst", "amount", (e) => e.printedTotals.sgst],
  ["printedTotals.igst", "amount", (e) => e.printedTotals.igst],
  ["printedTotals.total", "amount", (e) => e.printedTotals.total],
]

type Line = Expected["lines"][number]
const LINE: [keyof Line, Kind][] = [
  ["description", "text"],
  ["hsnSac", "code"],
  ["quantity", "number"],
  ["rate", "amount"],
  ["taxableAmount", "amount"],
  ["gstRatePercent", "number"],
  ["cgstAmount", "amount"],
  ["sgstAmount", "amount"],
  ["igstAmount", "amount"],
]

function score(
  field: string,
  path: string,
  kind: Kind,
  expected: string | null,
  actual: string | null,
  flags: ReviewFlag[]
): FieldScore {
  const correct =
    expected === null || actual === null
      ? expected === null && (actual === null || actual.trim() === "")
      : same(kind, expected, actual)
  return {
    field,
    path,
    expected,
    actual,
    correct,
    invented: expected === null && actual !== null && actual.trim() !== "",
    flagged: isFlagged(path, flags),
  }
}

/** Scores one bill. Lines are compared in printed order. */
export function scoreBill(
  expected: Expected,
  actual: Expected,
  flags: ReviewFlag[]
): FieldScore[] {
  const scores = HEADER.map(([field, kind, get]) =>
    score(field, field, kind, get(expected), get(actual), flags)
  )
  scores.push(
    score(
      "lines.count",
      "lines",
      "exact",
      String(expected.lines.length),
      String(actual.lines.length),
      flags
    )
  )
  expected.lines.forEach((line, i) => {
    const got = actual.lines[i]
    for (const [key, kind] of LINE) {
      const path = `lines[${i}].${key}`
      const want = line[key]
      if (!got) {
        // Missing line: every field is wrong, even ones not printed.
        scores.push({
          field: `lines[].${key}`,
          path,
          expected: want,
          actual: null,
          correct: false,
          invented: false,
          flagged: isFlagged(path, flags),
        })
        continue
      }
      scores.push(score(`lines[].${key}`, path, kind, want, got[key], flags))
    }
  })
  return scores
}

/** Scores a bill whose extraction failed: every field is wrong. */
export function scoreFailure(expected: Expected): FieldScore[] {
  const empty: Expected = {
    ...expected,
    vendor: { name: "", gstin: null, stateCode: null },
    billNumber: "",
    billDate: "",
    dueDate: null,
    placeOfSupplyStateCode: null,
    lines: [],
    printedTotals: {
      taxable: null,
      cgst: null,
      sgst: null,
      igst: null,
      total: null,
    },
  }
  return scoreBill(expected, empty, []).map((s) => ({
    ...s,
    actual: null,
    correct: false,
    invented: false,
  }))
}
