import { describe, expect, it } from "vitest"
import { paise } from "@workspace/ledger"

import { formatMoney, MINUS } from "@workspace/ui/lib/format-money"

const rupees = (r: number) => paise(Math.round(r * 100))
const NBSP = " "

describe("formatMoney: Indian grouping", () => {
  it.each([
    [0, "₹0"],
    [999, "₹999"],
    [1_000, "₹1,000"],
    [99_999, "₹99,999"],
    [1_00_000, "₹1,00,000"],
    [12_34_567, "₹12,34,567"],
    [12_34_56_789, "₹12,34,56,789"],
  ])("formats ₹%d as %s", (amount, expected) => {
    expect(formatMoney(rupees(amount))).toBe(expected)
  })

  it("handles amounts beyond Number.MAX_SAFE_INTEGER exactly", () => {
    expect(formatMoney(paise(123_456_789_012_345_678n))).toBe(
      "₹1,23,45,67,89,01,23,457"
    )
  })
})

describe("formatMoney: paise", () => {
  it("rounds to the nearest rupee by default, half away from zero", () => {
    expect(formatMoney(paise(99_949n))).toBe("₹999")
    expect(formatMoney(paise(99_950n))).toBe("₹1,000")
    expect(formatMoney(paise(-99_950n))).toBe(`${MINUS}₹1,000`)
  })

  it("shows paise when asked", () => {
    expect(formatMoney(paise(1_23_45_678_90n), { paise: true })).toBe(
      "₹1,23,45,678.90"
    )
    expect(formatMoney(paise(5n), { paise: true })).toBe("₹0.05")
  })
})

describe("formatMoney: negatives", () => {
  it("uses a true minus sign", () => {
    expect(formatMoney(rupees(-1_000))).toBe("−₹1,000")
    expect(formatMoney(rupees(-12_34_56_789))).toBe(`${MINUS}₹12,34,56,789`)
  })

  it("uses brackets in the ledger variant", () => {
    expect(formatMoney(rupees(-1_000), { ledger: true })).toBe("(₹1,000)")
    expect(formatMoney(rupees(1_000), { ledger: true })).toBe("₹1,000")
  })

  it("never shows a negative zero", () => {
    expect(formatMoney(paise(-40n))).toBe("₹0")
    expect(formatMoney(paise(-40n), { ledger: true })).toBe("₹0")
  })

  it("can drop the symbol", () => {
    expect(formatMoney(rupees(-1_00_000), { symbol: false })).toBe(
      `${MINUS}1,00,000`
    )
  })
})

describe("formatMoney: lakh/crore compact form", () => {
  it.each([
    [0, "₹0"],
    [999, "₹999"],
    [99_999, "₹99,999"],
    [1_00_000, `₹1${NBSP}L`],
    [1_50_000, `₹1.5${NBSP}L`],
    [12_34_567, `₹12.35${NBSP}L`],
    [99_99_999, `₹1${NBSP}Cr`],
    [1_00_00_000, `₹1${NBSP}Cr`],
    [12_34_56_789, `₹12.35${NBSP}Cr`],
    [1_234_00_00_000, `₹1,234${NBSP}Cr`],
  ])("formats ₹%d as %s", (amount, expected) => {
    expect(formatMoney(rupees(amount), { compact: true })).toBe(expected)
  })

  it("keeps the sign on compact negatives", () => {
    expect(formatMoney(rupees(-2_50_000), { compact: true })).toBe(
      `${MINUS}₹2.5${NBSP}L`
    )
    expect(
      formatMoney(rupees(-3_00_00_000), { compact: true, ledger: true })
    ).toBe(`(₹3${NBSP}Cr)`)
  })
})
