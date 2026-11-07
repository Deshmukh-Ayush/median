import { InvalidMoneyError, paise } from "./money"
import type { Money } from "./money"

// GST maths for Median's accounting rules (docs/plan/backend.md, rules 5–8
// and 11). Integer paise throughout; rates are basis points (18% = 1800).
// Every amount here is computed in code, never by AI.

/** GST rate in basis points: 18% = 1800, 0.25% = 25. */
export type RateBps = number

export type SupplyType =
  "intrastate" | "interstate" | "export_with_payment" | "export_lut" | "sez"

export interface GstSplit {
  readonly cgst: Money
  readonly sgst: Money
  readonly igst: Money
}

const BPS = 10_000n

function assertRate(rateBps: RateBps): bigint {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new InvalidMoneyError(`GST rate must be 0–10000 bps, got ${rateBps}`)
  }
  return BigInt(rateBps)
}

function assertNonNegative(amount: Money, what: string): void {
  if (amount < 0n) throw new InvalidMoneyError(`${what} can't be negative`)
}

/** round(numerator / denominator), halves away from zero, for non-negatives. */
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator)
}

/** Tax on a taxable amount at a rate, rounded to the paisa (half up). */
export function taxOn(taxable: Money, rateBps: RateBps): Money {
  assertNonNegative(taxable, "Taxable value")
  return paise(roundDiv(taxable * assertRate(rateBps), BPS))
}

/**
 * Rule 6: splits a tax amount by supply type. Intrastate → CGST + SGST in
 * halves with the odd paisa on CGST; anything else → IGST.
 */
export function splitTax(tax: Money, intrastate: boolean): GstSplit {
  assertNonNegative(tax, "Tax")
  if (!intrastate) return { cgst: paise(0n), sgst: paise(0n), igst: tax }
  const sgst = tax / 2n
  return { cgst: paise(tax - sgst), sgst: paise(sgst), igst: paise(0n) }
}

export interface SupplyTypeInput {
  /** The organisation's GST state code. */
  readonly orgStateCode: string
  /** Null for B2C sales where it's unknown: the org's state is used (rule 6). */
  readonly placeOfSupply: string | null
  /** Set only for exports and SEZ supplies. */
  readonly special?: "export_with_payment" | "export_lut" | "sez" | null
}

export interface ResolvedSupply {
  readonly supplyType: SupplyType
  readonly placeOfSupply: string
  /** CGST + SGST (true) or IGST (false). */
  readonly intrastate: boolean
  /** False for zero-rated exports under LUT. */
  readonly chargesGst: boolean
}

/**
 * Rule 6: supply type from place of supply vs the org's state, respecting
 * export and SEZ flags. Exports and SEZ supplies are always interstate (IGST);
 * export under LUT is zero-rated. Reverse charge is handled by the caller:
 * the supplier charges no tax regardless of supply type.
 */
export function resolveSupply(input: SupplyTypeInput): ResolvedSupply {
  const placeOfSupply = input.placeOfSupply ?? input.orgStateCode
  if (input.special) {
    return {
      supplyType: input.special,
      placeOfSupply,
      intrastate: false,
      chargesGst: input.special !== "export_lut",
    }
  }
  const intrastate = placeOfSupply === input.orgStateCode
  return {
    supplyType: intrastate ? "intrastate" : "interstate",
    placeOfSupply,
    intrastate,
    chargesGst: true,
  }
}

export interface LineInput {
  /** Quantity in thousandths (1.5 units = 1500). */
  readonly quantityMilli: bigint
  readonly unitPrice: Money
  readonly rateBps: RateBps
}

export interface LineTax extends GstSplit {
  readonly taxable: Money
  readonly total: Money
}

/** Taxable value of a line: quantity × unit price, rounded to the paisa. */
export function lineTaxable(
  line: Pick<LineInput, "quantityMilli" | "unitPrice">
): Money {
  if (line.quantityMilli <= 0n)
    throw new InvalidMoneyError("Quantity must be positive")
  assertNonNegative(line.unitPrice, "Unit price")
  return paise(roundDiv(line.quantityMilli * line.unitPrice, 1000n))
}

/**
 * Rule 7: GST computed per line in paise. `chargesGst` false (export under
 * LUT, reverse charge, composition, unregistered) gives zero tax.
 */
export function computeLine(
  line: LineInput,
  supply: { readonly intrastate: boolean; readonly chargesGst: boolean }
): LineTax {
  const taxable = lineTaxable(line)
  const tax = supply.chargesGst ? taxOn(taxable, line.rateBps) : paise(0n)
  const split = splitTax(tax, supply.intrastate)
  return { taxable, ...split, total: paise(taxable + tax) }
}

export interface DocumentTotals extends GstSplit {
  readonly taxable: Money
  /** Difference to the nearest rupee, -50 to +50 paise; post to Round-off. */
  readonly roundOff: Money
  /** Rounded to the nearest rupee. */
  readonly total: Money
}

/** Rule 7: sums the lines and rounds the total to the nearest rupee. */
export function documentTotals(lines: readonly LineTax[]): DocumentTotals {
  const sum = (pick: (l: LineTax) => Money) =>
    paise(lines.reduce((s, l) => s + pick(l), 0n))
  const exact = sum((l) => l.total)
  const total = paise(roundDiv(exact, 100n) * 100n)
  return {
    taxable: sum((l) => l.taxable),
    cgst: sum((l) => l.cgst),
    sgst: sum((l) => l.sgst),
    igst: sum((l) => l.igst),
    roundOff: paise(total - exact),
    total,
  }
}

/**
 * Rule 8: splits a GST-inclusive amount (a payment with no invoice).
 * taxable = round(amount × 100 / (100 + rate)); gst = amount − taxable.
 */
export function splitInclusive(
  amount: Money,
  rateBps: RateBps
): { readonly taxable: Money; readonly gst: Money } {
  assertNonNegative(amount, "Amount")
  const rate = assertRate(rateBps)
  const taxable = roundDiv(amount * BPS, BPS + rate)
  return { taxable: paise(taxable), gst: paise(amount - taxable) }
}

/** Rule 11: TDS rates tried when a receipt is short of the invoice total. */
export const TDS_RATES_BPS: readonly RateBps[] = [100, 200, 1000]

export interface TdsMatch {
  readonly rateBps: RateBps
  /** Deducted by the customer; book as TDS receivable. */
  readonly tds: Money
  readonly expectedReceipt: Money
}

/**
 * Rule 11: expected receipt = invoice total − (TDS rate × taxable value),
 * trying 1%, 2% and 10%. Returns the rate whose expected receipt equals the
 * amount received, or null. Matches go to the inbox until approved.
 */
export function matchTdsReceipt(input: {
  readonly received: Money
  readonly invoiceTotal: Money
  readonly taxable: Money
}): TdsMatch | null {
  for (const rateBps of TDS_RATES_BPS) {
    const tds = taxOn(input.taxable, rateBps)
    const expectedReceipt = paise(input.invoiceTotal - tds)
    if (expectedReceipt === input.received) {
      return { rateBps, tds, expectedReceipt }
    }
  }
  return null
}

/** Rule 5: financial year (April–March) of a date, e.g. "2026-27". */
export function financialYearOf(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4))
  const month = Number(isoDate.slice(5, 7))
  const start = month >= 4 ? year : year - 1
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`
}

/** Rule 5: invoice and credit-note numbers are 1–16 characters. */
export function isValidDocumentNumber(number: string): boolean {
  return number.length >= 1 && number.length <= 16
}

/** "7.5" → 7500n (thousandths). Throws on anything but a plain decimal. */
export function quantityMilliOf(quantity: string): bigint {
  const match = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(quantity.trim())
  if (!match) throw new InvalidMoneyError(`Not a quantity: ${quantity}`)
  const milli =
    BigInt(match[1] ?? "0") * 1000n + BigInt((match[2] ?? "").padEnd(3, "0"))
  if (milli <= 0n) throw new InvalidMoneyError("Quantity must be positive")
  return milli
}

/** 7500n → "7.5"; the inverse of quantityMilliOf. */
export function formatQuantityMilli(milli: bigint): string {
  const whole = milli / 1000n
  const frac = (milli % 1000n).toString().padStart(3, "0").replace(/0+$/, "")
  return frac ? `${whole}.${frac}` : String(whole)
}

/**
 * Rules 6–7 for a whole invoice or credit note: per-line GST, then totals
 * rounded to the nearest rupee. `exactTotal` replaces rupee rounding with a
 * target total (a credit note for a refund must equal the refund); the
 * difference still goes to Round-off and must be within ±50 paise.
 */
export function computeDocument(
  lines: readonly LineInput[],
  supply: { readonly intrastate: boolean; readonly chargesGst: boolean },
  options: { readonly exactTotal?: Money } = {}
): { readonly lines: readonly LineTax[]; readonly totals: DocumentTotals } {
  const computed = lines.map((l) => computeLine(l, supply))
  const totals = documentTotals(computed)
  if (options.exactTotal === undefined) return { lines: computed, totals }
  const exact = totals.total - totals.roundOff
  const roundOff = options.exactTotal - exact
  if (roundOff < -50n || roundOff > 50n)
    throw new InvalidMoneyError(
      `Target total is ${roundOff} paise from the computed total`
    )
  return {
    lines: computed,
    totals: { ...totals, roundOff: paise(roundOff), total: options.exactTotal },
  }
}
