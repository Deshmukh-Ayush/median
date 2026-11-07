/**
 * Integer paise in Indian words, as printed on invoices:
 * 1,18,000.50 → "Rupees One Lakh Eighteen Thousand and Fifty Paise Only".
 * Lakh/crore grouping; integer maths only. Display text, never stored.
 */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
] as const

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
] as const

/** 0–99 in words ("" for 0). */
function belowHundred(n: number): string {
  if (n < 20) return ONES[n] ?? ""
  const unit = ONES[n % 10] ?? ""
  return `${TENS[Math.floor(n / 10)] ?? ""}${unit ? ` ${unit}` : ""}`
}

/** 0–999 in words ("" for 0). */
function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100)
  const rest = belowHundred(n % 100)
  const head = hundreds ? `${ONES[hundreds] ?? ""} Hundred` : ""
  return [head, rest].filter(Boolean).join(" ")
}

/** A whole number of rupees in words; "Zero" for 0. */
export function rupeesInWords(rupees: bigint): string {
  if (rupees < 0n)
    throw new RangeError("Amount in words needs a non-negative amount")
  if (rupees === 0n) return "Zero"
  const parts: string[] = []
  let rest = rupees
  // Crores can themselves run past 99 ("One Hundred Twenty Crore").
  const crore = rest / 1_00_00_000n
  rest %= 1_00_00_000n
  if (crore > 0n) parts.push(`${rupeesInWords(crore)} Crore`)
  const groups: [bigint, string][] = [
    [1_00_000n, "Lakh"],
    [1_000n, "Thousand"],
  ]
  for (const [size, name] of groups) {
    const count = rest / size
    rest %= size
    if (count > 0n) parts.push(`${belowHundred(Number(count))} ${name}`)
  }
  if (rest > 0n) parts.push(belowThousand(Number(rest)))
  return parts.join(" ")
}

/** "Rupees … and … Paise Only" for an amount in paise. */
export function amountInWords(amountPaise: bigint): string {
  if (amountPaise < 0n)
    throw new RangeError("Amount in words needs a non-negative amount")
  const rupees = amountPaise / 100n
  const paise = Number(amountPaise % 100n)
  const paiseText = paise > 0 ? ` and ${belowHundred(paise)} Paise` : ""
  return `Rupees ${rupeesInWords(rupees)}${paiseText} Only`
}
