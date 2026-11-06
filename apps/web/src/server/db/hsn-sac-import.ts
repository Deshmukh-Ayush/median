// Parses the HSN/SAC rate file for scripts/import-hsn-sac-rates.ts. Kept free
// of "server-only" so the script can run it outside Next.js.
//
// File format (CSV, header required, one rate window per row):
//   code,description,rate_bps,effective_from,effective_to,condition,source
// Every row must cite its notification in `source`. Rates are never invented:
// the checked-in file (data/hsn-sac-rates.csv) is header-only until rates are
// copied from official notifications.

import { hsnSacRateImportRowSchema } from "@workspace/contracts"
import type { HsnSacRateImportRow } from "@workspace/contracts"
import Papa from "papaparse"

export const HSN_SAC_COLUMNS = [
  "code",
  "description",
  "rate_bps",
  "effective_from",
  "effective_to",
  "condition",
  "source",
] as const

export interface ParsedHsnSacFile {
  readonly rows: readonly HsnSacRateImportRow[]
  /** 1-based line numbers (header is line 1). */
  readonly errors: readonly {
    readonly line: number
    readonly message: string
  }[]
}

const blankToNull = (v: string | undefined) =>
  v === undefined || v.trim() === "" ? null : v.trim()

export function parseHsnSacRatesCsv(text: string): ParsedHsnSacFile {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  })
  const fields = parsed.meta.fields ?? []
  const missing = HSN_SAC_COLUMNS.filter((c) => !fields.includes(c))
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: `Missing columns: ${missing.join(", ")}` }],
    }
  }

  const rows: HsnSacRateImportRow[] = []
  const rowLines: number[] = []
  const errors: { line: number; message: string }[] = parsed.errors.map(
    (e) => ({ line: (e.row ?? 0) + 2, message: e.message })
  )
  parsed.data.forEach((raw, i) => {
    const rateText = blankToNull(raw["rate_bps"])
    const result = hsnSacRateImportRowSchema.safeParse({
      code: raw["code"]?.trim(),
      description: raw["description"],
      rateBps:
        rateText !== null && /^\d+$/.test(rateText)
          ? Number(rateText)
          : rateText,
      effectiveFrom: blankToNull(raw["effective_from"]),
      effectiveTo: blankToNull(raw["effective_to"]),
      condition: blankToNull(raw["condition"]),
      source: raw["source"],
    })
    if (result.success) {
      rows.push(result.data)
      rowLines.push(i + 2)
    } else
      errors.push({
        line: i + 2,
        message: result.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      })
  })

  // Two windows for the same code and condition must not overlap.
  const seen = new Map<string, HsnSacRateImportRow[]>()
  rows.forEach((row, i) => {
    const key = `${row.code}\u0000${row.condition ?? ""}`
    const others = seen.get(key) ?? []
    const clash = others.find(
      (o) =>
        (o.effectiveTo === null || row.effectiveFrom <= o.effectiveTo) &&
        (row.effectiveTo === null || o.effectiveFrom <= row.effectiveTo)
    )
    if (clash)
      errors.push({
        line: rowLines[i] ?? 0,
        message: `${row.code}: window overlaps the one from ${clash.effectiveFrom}`,
      })
    seen.set(key, [...others, row])
  })
  return { rows, errors }
}
