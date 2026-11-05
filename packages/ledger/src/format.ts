import { InvalidMoneyError, paise } from "./money.js"
import type { Money } from "./money.js"

/**
 * Groups the digits of a non-negative integer string the Indian way:
 * last three, then pairs (1,23,45,678).
 */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits
  const lastThree = digits.slice(-3)
  const rest = digits.slice(0, -3)
  const pairs: string[] = []
  for (let end = rest.length; end > 0; end -= 2) {
    pairs.unshift(rest.slice(Math.max(0, end - 2), end))
  }
  return `${pairs.join(",")},${lastThree}`
}

export interface FormatInrOptions {
  /** Show paise (".50"). Default true. With false, paise are dropped, not rounded. */
  readonly paise?: boolean
  /** Prefix with "₹". Default true. */
  readonly symbol?: boolean
}

/**
 * Formats Money as Indian rupees with lakh/crore grouping: ₹1,23,45,678.90.
 * Negative amounts render as "-₹1,000.00".
 */
export function formatInr(
  amount: Money,
  options: FormatInrOptions = {}
): string {
  const showPaise = options.paise ?? true
  const symbol = options.symbol ?? true
  const negative = amount < 0n
  const value: bigint = amount
  const abs = negative ? -value : value
  const rupees = groupIndian((abs / 100n).toString())
  const fraction = (abs % 100n).toString().padStart(2, "0")
  const body = showPaise ? `${rupees}.${fraction}` : rupees
  return `${negative ? "-" : ""}${symbol ? "₹" : ""}${body}`
}

const RUPEES_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/

/**
 * Parses a rupee amount written as text ("1,18,000.50", "₹ 1180", "-25.5")
 * into integer paise, exactly, with no floating point.
 *
 * Use this for amounts from forms, CSVs and AI extraction. Throws
 * InvalidMoneyError for anything that isn't a plain amount with at most two
 * decimal places.
 */
export function parseRupees(text: string): Money {
  const cleaned = text.replace(/[₹,\s]/g, "").replace(/^INR/i, "")
  const match = RUPEES_PATTERN.exec(cleaned)
  if (!match) {
    throw new InvalidMoneyError(`Not a rupee amount: ${JSON.stringify(text)}`)
  }
  const [, sign, whole = "0", fraction = ""] = match
  const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))
  return paise(sign ? -value : value)
}
