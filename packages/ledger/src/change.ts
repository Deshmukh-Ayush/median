import type { Money } from "./money"

/**
 * Change from `previous` to `current` in basis points of `previous`
 * (+12.93% = 1293), rounded half away from zero. Null when `previous` is
 * zero (no meaningful percentage). Integer maths only.
 */
export function percentChangeBps(
  current: Money,
  previous: Money
): number | null {
  if (previous === 0n) return null
  const numerator = (current - previous) * 10_000n
  const prev: bigint = previous
  const denominator = prev < 0n ? -prev : prev
  const negative = numerator < 0n
  const abs = negative ? -numerator : numerator
  const rounded = (2n * abs + denominator) / (2n * denominator)
  return Number(negative ? -rounded : rounded)
}
