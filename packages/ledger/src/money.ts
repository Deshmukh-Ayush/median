declare const moneyBrand: unique symbol

/**
 * An amount of Indian rupees stored as an integer number of paise
 * (1 INR = 100 paise). Never a float.
 *
 * Backed by `bigint` so it maps 1:1 onto a Postgres `bigint` column and cannot
 * silently lose precision above Number.MAX_SAFE_INTEGER.
 */
export type Money = bigint & { readonly [moneyBrand]: "Money" }

export class InvalidMoneyError extends Error {
  override readonly name = "InvalidMoneyError"
}

/**
 * Builds a Money value from an integer number of paise.
 * Rejects fractional, NaN, infinite and unsafe numbers.
 */
export function paise(amount: bigint | number): Money {
  if (typeof amount === "bigint") return amount as Money
  if (!Number.isSafeInteger(amount)) {
    throw new InvalidMoneyError(
      `Money must be an integer number of paise, got ${String(amount)}`
    )
  }
  return BigInt(amount) as Money
}

export function isMoney(value: unknown): value is Money {
  return typeof value === "bigint"
}

export const ZERO: Money = paise(0n)

export function addMoney(a: Money, b: Money): Money {
  return (a + b) as Money
}
