import { formatInr, paise } from "@workspace/ledger"
import type { Money } from "@workspace/ledger"

/** U+2212 MINUS SIGN: same width as digits, read as "minus". */
export const MINUS = "−"
const NBSP = " "

const LAKH_PAISE = 1_00_000n * 100n
const CRORE_PAISE = 1_00_00_000n * 100n

export interface FormatMoneyOptions {
  /**
   * Show paise (₹1,234.50). Default false: rounds to the nearest rupee,
   * half away from zero. This is display only; stored amounts never change.
   */
  readonly paise?: boolean
  /**
   * Compact Indian form from 1 lakh up: ₹1.5 L, ₹12.35 Cr. Below 1 lakh the
   * full amount is shown. Two decimals at most, trailing zeros dropped.
   */
  readonly compact?: boolean
  /** Negatives in brackets, (₹1,000), for ledger and CA views. */
  readonly ledger?: boolean
  /** Prefix with ₹. Default true. */
  readonly symbol?: boolean
}

/** Divides a non-negative bigint and rounds half up. */
function divRound(value: bigint, divisor: bigint): bigint {
  return (value + divisor / 2n) / divisor
}

function rupees(absPaise: bigint, showPaise: boolean): string {
  if (showPaise) return formatInr(paise(absPaise), { symbol: false })
  const whole = divRound(absPaise, 100n)
  return formatInr(paise(whole * 100n), { symbol: false, paise: false })
}

/** "1.5", "12.35", "1" from a value in hundredths. */
function trimHundredths(hundredths: bigint): string {
  const whole = hundredths / 100n
  const fraction = (hundredths % 100n).toString().padStart(2, "0")
  const trimmed = fraction.replace(/0+$/, "")
  return trimmed ? `${whole.toString()}.${trimmed}` : whole.toString()
}

function compactRupees(absPaise: bigint): string | null {
  if (absPaise < LAKH_PAISE) return null
  // Value in hundredths of a lakh / crore, rounded half up.
  const lakhs = divRound(absPaise * 100n, LAKH_PAISE)
  if (lakhs < 100n * 100n) return `${trimHundredths(lakhs)}${NBSP}L`
  const crores = divRound(absPaise * 100n, CRORE_PAISE)
  return `${formatInr(paise(crores), { symbol: false }).replace(/\.?0+$/, "")}${NBSP}Cr`
}

/**
 * Formats integer paise for display with Indian grouping: ₹1,23,45,678.
 * Negatives use a true minus (−₹1,000), or brackets with `ledger`.
 */
export function formatMoney(
  amount: Money,
  options: FormatMoneyOptions = {}
): string {
  const value: bigint = amount
  const negative = value < 0n
  const abs = negative ? -value : value
  const symbol = options.symbol === false ? "" : "₹"
  const body =
    (options.compact ? compactRupees(abs) : null) ??
    rupees(abs, options.paise ?? false)
  const unsigned = `${symbol}${body}`
  const isZero = /^[₹]?0(\.0+)?$/.test(unsigned)
  if (!negative || isZero) return unsigned
  return options.ledger ? `(${unsigned})` : `${MINUS}${unsigned}`
}
