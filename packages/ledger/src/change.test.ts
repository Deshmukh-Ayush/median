import { describe, expect, it } from "vitest"

import { percentChangeBps } from "./change"
import { paise } from "./money"

describe("percentChangeBps", () => {
  it("returns the change in basis points of the previous value", () => {
    expect(percentChangeBps(paise(3_10_000_00n), paise(2_74_500_00n))).toBe(
      1293
    ) // +12.93%
    expect(percentChangeBps(paise(50n), paise(100n))).toBe(-5000)
    expect(percentChangeBps(paise(100n), paise(100n))).toBe(0)
  })

  it("rounds half away from zero", () => {
    expect(percentChangeBps(paise(20_001n), paise(20_000n))).toBe(1) // exactly 0.5 bp
    expect(percentChangeBps(paise(19_999n), paise(20_000n))).toBe(-1)
  })

  it("is null when there was nothing before", () => {
    expect(percentChangeBps(paise(100n), paise(0n))).toBeNull()
  })
})
