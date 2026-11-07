import "server-only"

import { isoDateSchema } from "@workspace/contracts"
import { parseRupees } from "@workspace/ledger"

import { gstinProblem, isGstStateCode } from "@/lib/gstin"

import type { AiBillExtraction } from "./bill-extraction"

/**
 * Deterministic review checks on an extracted bill. We don't trust the model's
 * own confidence: every check here is code. Checks only *flag* fields; they
 * never change a printed value.
 *
 * - `needs_review`: uncertain or failed a check. Goes to the inbox.
 * - `not_printed`: the value isn't on the bill. Informational only.
 */
export type ReviewFlagKind = "needs_review" | "not_printed"

export interface ReviewFlag {
  field: string
  kind: ReviewFlagKind
  reason: string
  /** "check": a deterministic check here. "model": the model's own flag. */
  source: "check" | "model"
}

export interface BillReview {
  needsReview: ReviewFlag[]
  notPrinted: ReviewFlag[]
}

/** Rounding a vendor may legitimately apply (per line, or round-off). */
const TOLERANCE_PAISE = 100n

const rupees = (paise: bigint) => {
  const sign = paise < 0n ? "-" : ""
  const abs = paise < 0n ? -paise : paise
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`
}

function money(text: string | null): bigint | null | "invalid" {
  if (text === null) return null
  try {
    return parseRupees(text)
  } catch {
    return "invalid"
  }
}

/** "2.5" → { units: 25n, scale: 10n }. Null if it isn't a plain decimal. */
function decimal(text: string | null): { units: bigint; scale: bigint } | null {
  if (text === null) return null
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text.replace(/[,\s%]/g, ""))
  if (!match) return null
  const fraction = match[2] ?? ""
  return {
    units: BigInt(`${match[1] ?? "0"}${fraction}`),
    scale: 10n ** BigInt(fraction.length),
  }
}

/** amount × (rate%) in paise, rounded half up. */
function percentOf(amount: bigint, rate: { units: bigint; scale: bigint }) {
  const denominator = 100n * rate.scale
  return (amount * rate.units * 2n + denominator) / (2n * denominator)
}

const abs = (n: bigint) => (n < 0n ? -n : n)

/** A decimal percent as whole basis points, or null if it has finer precision. */
function toBps(rate: { units: bigint; scale: bigint }): number | null {
  const scaled = rate.units * 100n
  return scaled % rate.scale === 0n ? Number(scaled / rate.scale) : null
}

export interface ReviewBillOptions {
  /**
   * Is `rateBps` a standard GST slab on `date` (YYYY-MM-DD)? Slabs are
   * effective-dated (e.g. 12% and 28% ended on 21 Sep 2025), so a rate is
   * checked against the bill date, not today. extract-bill.ts passes
   * `isStandardGstSlab` from @workspace/contracts; tests pass a stand-in.
   * Without it the check is skipped.
   */
  readonly isStandardGstSlab?: (rateBps: number, date: string) => boolean
}

export function reviewBill(
  bill: AiBillExtraction,
  today: string,
  options: ReviewBillOptions = {}
): BillReview {
  const flags = new Map<string, ReviewFlag>()
  const add = (
    field: string,
    kind: ReviewFlagKind,
    reason: string,
    source: ReviewFlag["source"] = "check"
  ) => {
    const existing = flags.get(field)
    // needs_review wins over not_printed; the first reason is kept.
    if (
      existing &&
      (existing.kind === "needs_review" || kind === "not_printed")
    )
      return
    flags.set(field, { field, kind, reason, source })
  }
  const review = (field: string, reason: string) =>
    add(field, "needs_review", reason)
  const missing = (field: string) => add(field, "not_printed", "not printed")

  // --- Vendor GSTIN and states
  const gstin = bill.vendor.gstin?.trim().toUpperCase() ?? null
  const gstinState = gstin && !gstinProblem(gstin) ? gstin.slice(0, 2) : null
  if (gstin === null) {
    review("vendor.gstin", "no GSTIN found; input tax credit needs one")
  } else {
    const problem = gstinProblem(gstin)
    if (problem === "format") review("vendor.gstin", "not a valid GSTIN format")
    if (problem === "state") review("vendor.gstin", "unknown GST state code")
    if (problem === "checksum")
      review("vendor.gstin", "GSTIN check digit doesn't match; likely misread")
  }
  if (
    gstinState &&
    bill.vendor.stateCode &&
    bill.vendor.stateCode !== gstinState
  )
    review("vendor.stateCode", `GSTIN says state ${gstinState}`)

  const pos = bill.placeOfSupplyStateCode
  if (pos === null) missing("placeOfSupplyStateCode")
  else if (!isGstStateCode(pos))
    review("placeOfSupplyStateCode", "not a GST state code")
  const printedPosCode = bill.placeOfSupply
    ? /\b(\d{2})\b/.exec(bill.placeOfSupply)?.[1]
    : undefined
  if (pos && printedPosCode && printedPosCode !== pos)
    review(
      "placeOfSupplyStateCode",
      `printed place of supply shows code ${printedPosCode}`
    )

  // Same state → CGST + SGST; different states → IGST.
  const hasSplit =
    bill.printedTotals.cgst !== null ||
    bill.printedTotals.sgst !== null ||
    bill.lines.some((l) => l.cgstAmount !== null || l.sgstAmount !== null)
  const hasIgst =
    bill.printedTotals.igst !== null ||
    bill.lines.some((l) => l.igstAmount !== null)
  if (gstinState && pos && isGstStateCode(pos)) {
    if (gstinState === pos && hasIgst)
      review(
        "placeOfSupplyStateCode",
        `vendor and place of supply are both state ${pos}, but IGST is charged`
      )
    if (gstinState !== pos && hasSplit)
      review(
        "placeOfSupplyStateCode",
        `vendor (${gstinState}) and place of supply (${pos}) differ, but CGST/SGST is charged`
      )
  }

  // --- Dates
  const billDateValid = isoDateSchema.safeParse(bill.billDate).success
  if (!billDateValid) review("billDate", "not a valid date")
  else if (bill.billDate > today) review("billDate", "date is in the future")
  if (bill.dueDate === null) missing("dueDate")
  else if (!isoDateSchema.safeParse(bill.dueDate).success)
    review("dueDate", "not a valid date")
  else if (bill.dueDate < bill.billDate)
    review("dueDate", "due date is before the bill date")

  // --- Lines
  let taxableSum = 0n
  let lineTaxesOk = true
  const lineTax = { cgst: 0n, sgst: 0n, igst: 0n }
  const lineTaxPrinted = { cgst: true, sgst: true, igst: true }
  let expectedTax = 0n
  let expectedTaxKnown = true

  bill.lines.forEach((line, i) => {
    const at = (key: string) => `lines[${i}].${key}`

    if (line.hsnSac === null) missing(at("hsnSac"))
    else if (!/^(\d{4}|\d{6}|\d{8})$/.test(line.hsnSac.replace(/\s/g, "")))
      review(at("hsnSac"), "HSN/SAC must be 4, 6 or 8 digits")

    const taxable = money(line.taxableAmount)
    if (taxable === "invalid" || taxable === null) {
      review(at("taxableAmount"), "not an amount")
      lineTaxesOk = false
      expectedTaxKnown = false
      return
    }
    taxableSum += taxable

    const quantity = decimal(line.quantity)
    const rate = money(line.rate)
    if (line.quantity === null) missing(at("quantity"))
    else if (!quantity) review(at("quantity"), "not a number")
    if (line.rate === null) missing(at("rate"))
    else if (rate === "invalid") review(at("rate"), "not an amount")
    if (quantity && typeof rate === "bigint") {
      const product =
        (rate * quantity.units * 2n + quantity.scale) / (2n * quantity.scale)
      if (abs(product - taxable) > TOLERANCE_PAISE)
        review(
          at("taxableAmount"),
          `quantity × rate is ${rupees(product)}, printed ${line.taxableAmount}`
        )
    }

    const gstRate = decimal(line.gstRatePercent)
    if (line.gstRatePercent === null) {
      missing(at("gstRatePercent"))
      expectedTaxKnown = false
    } else if (!gstRate) {
      review(at("gstRatePercent"), "not a rate")
      expectedTaxKnown = false
    } else {
      expectedTax += percentOf(taxable, gstRate)
      // A rate off the slab list may be a misread or a special rate (3% on
      // gold, 0.25% on rough diamonds): flag it for a person, never reject.
      const isSlab = options.isStandardGstSlab
      if (isSlab && billDateValid) {
        const bps = toBps(gstRate)
        if (bps === null || !isSlab(bps, bill.billDate))
          review(
            at("gstRatePercent"),
            `${line.gstRatePercent}% isn’t a standard GST rate on the bill date (${bill.billDate}); check for a misread or a special rate`
          )
      }
    }

    for (const key of ["cgst", "sgst", "igst"] as const) {
      const field = `${key}Amount` as const
      const value = money(line[field])
      if (value === null) {
        lineTaxPrinted[key] = false
        continue
      }
      if (value === "invalid") {
        review(at(field), "not an amount")
        lineTaxesOk = false
        continue
      }
      lineTax[key] += value
    }
    // A printed line tax should match the line's taxable value × rate.
    if (gstRate) {
      const half = { units: gstRate.units, scale: gstRate.scale * 2n }
      const checks = [
        ["cgstAmount", half, "CGST"],
        ["sgstAmount", half, "SGST"],
        ["igstAmount", gstRate, "IGST"],
      ] as const
      for (const [field, rate, label] of checks) {
        const printed = money(line[field])
        if (
          typeof printed === "bigint" &&
          abs(percentOf(taxable, rate) - printed) > TOLERANCE_PAISE
        )
          review(
            at(field),
            `${line.gstRatePercent}% of ${line.taxableAmount} doesn't give this ${label}`
          )
      }
    }
  })

  // --- Totals: lines must add up to the printed totals (validation only).
  const totals = {
    taxable: money(bill.printedTotals.taxable),
    cgst: money(bill.printedTotals.cgst),
    sgst: money(bill.printedTotals.sgst),
    igst: money(bill.printedTotals.igst),
    total: money(bill.printedTotals.total),
  }
  for (const [key, value] of Object.entries(totals)) {
    if (value === "invalid") review(`printedTotals.${key}`, "not an amount")
  }

  if (totals.taxable === null) missing("printedTotals.taxable")
  else if (
    typeof totals.taxable === "bigint" &&
    lineTaxesOk &&
    totals.taxable !== taxableSum
  )
    review(
      "printedTotals.taxable",
      `lines add up to ${rupees(taxableSum)}, printed ${bill.printedTotals.taxable ?? ""}`
    )

  const taxTotal = { cgst: 0n, sgst: 0n, igst: 0n }
  let taxKnown = lineTaxesOk
  for (const key of ["cgst", "sgst", "igst"] as const) {
    const printed = totals[key]
    if (printed === "invalid") {
      taxKnown = false
      continue
    }
    if (printed === null) {
      if (lineTaxPrinted[key] && lineTax[key] !== 0n)
        taxTotal[key] = lineTax[key]
      continue
    }
    taxTotal[key] = printed
    if (lineTaxesOk && lineTaxPrinted[key] && lineTax[key] !== printed)
      review(
        `printedTotals.${key}`,
        `line ${key.toUpperCase()} adds up to ${rupees(lineTax[key])}, printed ${bill.printedTotals[key] ?? ""}`
      )
  }
  const taxes = taxTotal.cgst + taxTotal.sgst + taxTotal.igst

  // Taxes should match taxable × rate across lines (allowing rounding).
  if (taxKnown && expectedTaxKnown && taxes > 0n) {
    const slack = TOLERANCE_PAISE * BigInt(Math.max(1, bill.lines.length))
    if (abs(expectedTax - taxes) > slack)
      review(
        "printedTotals.total",
        `lines' GST rates give ${rupees(expectedTax)} tax, printed taxes are ${rupees(taxes)}`
      )
  }

  if (totals.total === null) {
    review("printedTotals.total", "no invoice total found")
  } else if (typeof totals.total === "bigint" && taxKnown && lineTaxesOk) {
    const base =
      typeof totals.taxable === "bigint" ? totals.taxable : taxableSum
    const computed = base + taxes
    // Round-off lines are up to ₹1.
    if (abs(computed - totals.total) > TOLERANCE_PAISE)
      review(
        "printedTotals.total",
        `taxable + taxes is ${rupees(computed)}, printed total ${bill.printedTotals.total ?? ""}`
      )
  }

  // --- The model's own flags: informational if the value is missing,
  // otherwise needs review (we keep them, but never rely on them).
  for (const flag of bill.lowConfidenceFields) {
    if (flags.has(flag.field)) continue
    const kind =
      valueAt(bill, flag.field) === null ? "not_printed" : "needs_review"
    add(flag.field, kind, `model: ${flag.reason}`, "model")
  }

  const all = [...flags.values()]
  return {
    needsReview: all.filter((f) => f.kind === "needs_review"),
    notPrinted: all.filter((f) => f.kind === "not_printed"),
  }
}

/** Reads a flagged path such as "lines[2].hsnSac". Undefined if unknown. */
function valueAt(bill: AiBillExtraction, path: string): unknown {
  let current: unknown = bill
  for (const part of path.replace(/\[(\d+)\]/g, ".$1").split(".")) {
    if (current === null || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}
