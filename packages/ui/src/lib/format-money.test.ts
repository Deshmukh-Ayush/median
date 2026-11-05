import { describe, expect, it } from "vitest"
import { paise } from "@workspace/ledger"

import { formatMoney, MINUS } from "@workspace/ui/lib/format-money"

const rupees = (r: number) => paise(Math.round(r * 100))
const NBSP = " "

describe("formatMoney: exact paise by default", () => {
  it.each([
    [0n, "₹0.00"],
    [99_900n, "₹999.00"],
    [1_00_000n, "₹1,000.00"],
    [1_00_00_000n, "₹1,00,000.00"],
    [1_23_456_78n, "₹1,23,456.78"],
    [12_34_56_789_00n, "₹12,34,56,789.00"],
    [5n, "₹0.05"],
  ])("formats %d paise as %s", (amount, expected) => {
    expect(formatMoney(paise(amount))).toBe(expected)
  })

  it("never rounds unless asked", () => {
    expect(formatMoney(paise(99_999n))).toBe("₹999.99")
  })

  it("handles amounts beyond Number.MAX_SAFE_INTEGER exactly", () => {
    expect(formatMoney(paise(123_456_789_012_345_678n))).toBe(
      "₹1,23,45,67,89,01,23,456.78"
    )
  })
})

describe("formatMoney: roundToRupee (explicit)", () => {
  it.each([
    [0, "₹0"],
    [999, "₹999"],
    [1_000, "₹1,000"],
    [1_00_000, "₹1,00,000"],
    [12_34_56_789, "₹12,34,56,789"],
  ])("formats ₹%d as %s", (amount, expected) => {
    expect(formatMoney(rupees(amount), { roundToRupee: true })).toBe(expected)
  })

  it("rounds half away from zero", () => {
    expect(formatMoney(paise(99_949n), { roundToRupee: true })).toBe("₹999")
    expect(formatMoney(paise(99_950n), { roundToRupee: true })).toBe("₹1,000")
    expect(formatMoney(paise(-99_950n), { roundToRupee: true })).toBe(
      `${MINUS}₹1,000`
    )
  })
})

describe("formatMoney: negatives", () => {
  it("uses a true minus sign", () => {
    expect(formatMoney(rupees(-1_000))).toBe("−₹1,000.00")
    expect(formatMoney(paise(-12_34_56_789_50n))).toBe(
      `${MINUS}₹12,34,56,789.50`
    )
  })

  it("uses brackets in the ledger variant", () => {
    expect(formatMoney(rupees(-1_000), { ledger: true })).toBe("(₹1,000.00)")
    expect(formatMoney(rupees(1_000), { ledger: true })).toBe("₹1,000.00")
  })

  it("never shows a negative zero", () => {
    expect(formatMoney(paise(0n))).toBe("₹0.00")
    expect(formatMoney(paise(-40n), { roundToRupee: true })).toBe("₹0")
    expect(formatMoney(paise(-40n), { roundToRupee: true, ledger: true })).toBe(
      "₹0"
    )
  })

  it("keeps sub-rupee negatives exact", () => {
    expect(formatMoney(paise(-40n))).toBe(`${MINUS}₹0.40`)
  })

  it("can drop the symbol", () => {
    expect(formatMoney(rupees(-1_00_000), { symbol: false })).toBe(
      `${MINUS}1,00,000.00`
    )
  })
})

describe("formatMoney: lakh/crore compact form (explicit)", () => {
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
