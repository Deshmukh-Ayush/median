/**
 * Offline regression guard for the review rules, using simulated misreads
 * (no model). The full table is in the eval report.
 *   npx vitest run --config evals/vitest.config.ts evals/bills/misreads
 */
import { fileURLToPath } from "node:url"

import { expect, it } from "vitest"

import { todayIso } from "@/lib/format-date"

import { loadGroundTruth } from "./fixtures"
import { simulateMisreads } from "./misreads"

const DATA_DIR = fileURLToPath(new URL("./data", import.meta.url))

it("catches simulated misreads in checkable fields", () => {
  const stats = simulateMisreads(loadGroundTruth(DATA_DIR), todayIso())
  const rate = (field: string) => {
    const s = stats.find((x) => x.field === field)
    return s ? s.caught / s.total : 0
  }
  expect(rate("vendor.gstin")).toBe(1)
  expect(rate("printedTotals.total")).toBe(1)
  expect(rate("lines[].taxableAmount")).toBe(1)
  expect(rate("lines[].gstRatePercent")).toBeGreaterThan(0.95)
  const total = stats.reduce((n, s) => n + s.total, 0)
  const caught = stats.reduce((n, s) => n + s.caught, 0)
  expect(caught / total).toBeGreaterThan(0.8)
})
