/**
 * Simulated misreads: change one digit in one printed field of a correct
 * extraction, then check whether `reviewBill` catches it. Offline, no model.
 * This measures the deterministic checks on many more misreads than a live
 * run produces.
 */
import {
  aiBillExtractionSchema,
  type AiBillExtraction,
} from "@/server/ai/bill-extraction"
import { reviewBill } from "@/server/ai/bill-review"

import type { GroundTruth } from "./fixtures"

export interface MisreadStats {
  field: string
  total: number
  /** Some needs_review flag was raised, so the bill goes to a reviewer. */
  caught: number
  /** The changed field itself was flagged. */
  pinpointed: number
}

/** Changes the middle rupee digit (or middle digit) of a value. */
export function misread(value: string): string {
  const head = value.includes(".")
    ? value.slice(0, value.lastIndexOf("."))
    : value
  const positions = [...head].flatMap((c, i) => (/\d/.test(c) ? [i] : []))
  const at = positions[Math.floor(positions.length / 2)]
  if (at === undefined) return value
  const digit = Number(value.charAt(at))
  const next = String((digit + 3) % 10)
  return value.slice(0, at) + next + value.slice(at + 1)
}

type Mutable = {
  get: (b: AiBillExtraction) => string | null
  set: (b: AiBillExtraction, v: string) => void
}

function targets(bill: AiBillExtraction): [string, string, Mutable][] {
  const out: [string, string, Mutable][] = [
    [
      "vendor.gstin",
      "vendor.gstin",
      { get: (b) => b.vendor.gstin, set: (b, v) => (b.vendor.gstin = v) },
    ],
    [
      "billNumber",
      "billNumber",
      { get: (b) => b.billNumber, set: (b, v) => (b.billNumber = v) },
    ],
    [
      "billDate",
      "billDate",
      { get: (b) => b.billDate, set: (b, v) => (b.billDate = v) },
    ],
    [
      "placeOfSupplyStateCode",
      "placeOfSupplyStateCode",
      {
        get: (b) => b.placeOfSupplyStateCode,
        set: (b, v) => (b.placeOfSupplyStateCode = v),
      },
    ],
  ]
  for (const key of ["taxable", "cgst", "sgst", "igst", "total"] as const) {
    out.push([
      `printedTotals.${key}`,
      `printedTotals.${key}`,
      {
        get: (b) => b.printedTotals[key],
        set: (b, v) => (b.printedTotals[key] = v),
      },
    ])
  }
  bill.lines.forEach((_, i) => {
    for (const key of [
      "hsnSac",
      "quantity",
      "rate",
      "taxableAmount",
      "gstRatePercent",
      "cgstAmount",
      "sgstAmount",
      "igstAmount",
    ] as const) {
      out.push([
        `lines[].${key}`,
        `lines[${i}].${key}`,
        {
          get: (b) => b.lines[i]?.[key] ?? null,
          set: (b, v) => {
            const line = b.lines[i]
            if (line) line[key] = v
          },
        },
      ])
    }
  })
  return out
}

export function simulateMisreads(
  truths: GroundTruth[],
  today: string
): MisreadStats[] {
  const stats = new Map<string, MisreadStats>()
  for (const truth of truths) {
    const correct = aiBillExtractionSchema.parse({
      ...truth.expected,
      lowConfidenceFields: [],
    })
    for (const [field, path, target] of targets(correct)) {
      const original = target.get(correct)
      if (original === null) continue
      const changed = misread(original)
      if (changed === original) continue
      const bill = structuredClone(correct)
      target.set(bill, changed)
      const { needsReview } = reviewBill(bill, today)
      const entry = stats.get(field) ?? {
        field,
        total: 0,
        caught: 0,
        pinpointed: 0,
      }
      entry.total += 1
      if (needsReview.length > 0) entry.caught += 1
      if (needsReview.some((f) => f.field === path)) entry.pinpointed += 1
      stats.set(field, entry)
    }
  }
  return [...stats.values()]
}
