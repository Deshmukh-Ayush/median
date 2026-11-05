import { describe, expect, it } from "vitest"

import { formatInr, parseRupees } from "./format.js"
import { InvalidMoneyError, paise } from "./money.js"

describe("formatInr", () => {
  it("uses lakh/crore grouping", () => {
    expect(formatInr(paise(12_345_678_00n))).toBe("₹1,23,45,678.00")
    expect(formatInr(paise(1_00_000_00n))).toBe("₹1,00,000.00")
    expect(formatInr(paise(99_999n))).toBe("₹999.99")
    expect(formatInr(paise(5n))).toBe("₹0.05")
  })

  it("formats negatives and options", () => {
    expect(formatInr(paise(-1_000_00n))).toBe("-₹1,000.00")
    expect(formatInr(paise(1_23_456_78n), { paise: false })).toBe("₹1,23,456")
    expect(formatInr(paise(1_000_00n), { symbol: false })).toBe("1,000.00")
  })
})

describe("parseRupees", () => {
  it("parses formatted amounts into exact paise", () => {
    expect(parseRupees("1,18,000.50")).toBe(1_18_000_50n)
    expect(parseRupees("₹ 1180")).toBe(1_180_00n)
    expect(parseRupees("0.1")).toBe(10n)
    expect(parseRupees("-25.5")).toBe(-25_50n)
    expect(parseRupees("INR 99.99")).toBe(99_99n)
  })

  it("never goes through floating point", () => {
    // 0.1 + 0.2 style errors would show up here.
    expect(parseRupees("1234567890123.07")).toBe(123_456_789_012_307n)
  })

  it("rejects non-amounts and sub-paise precision", () => {
    for (const bad of ["", "abc", "1.234", "1e5", "1.2.3", "--1"]) {
      expect(() => parseRupees(bad)).toThrow(InvalidMoneyError)
    }
  })
})
