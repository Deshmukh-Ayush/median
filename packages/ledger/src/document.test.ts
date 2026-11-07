import { describe, expect, it } from "vitest"

import { computeDocument, formatQuantityMilli, quantityMilliOf } from "./gst"
import { InvalidMoneyError, paise } from "./money"

describe("quantityMilliOf / formatQuantityMilli", () => {
  it.each([
    ["1", 1000n],
    ["7.5", 7500n],
    ["0.001", 1n],
    ["12.125", 12125n],
  ])("%s ↔ %i", (text, milli) => {
    expect(quantityMilliOf(text)).toBe(milli)
    expect(formatQuantityMilli(milli)).toBe(text)
  })

  it.each(["0", "-1", "1.2345", "1e3", "", "1,000"])("rejects %j", (text) => {
    expect(() => quantityMilliOf(text)).toThrow(InvalidMoneyError)
  })
})

describe("computeDocument (rules 6–7)", () => {
  const intra = { intrastate: true, chargesGst: true }

  it("taxes per line and rounds the total to the rupee", () => {
    // 3 × ₹333.33 at 18%: taxable 999.99, tax 180.00 (179.9982 → 180.00)
    const { lines, totals } = computeDocument(
      [{ quantityMilli: 3000n, unitPrice: paise(333_33n), rateBps: 1800 }],
      intra
    )
    expect(lines[0]).toMatchObject({
      taxable: 999_99n,
      cgst: 90_00n,
      sgst: 90_00n,
    })
    expect(totals).toMatchObject({ total: 1180_00n, roundOff: 1n })
  })

  it("puts the odd paisa on CGST", () => {
    const { totals } = computeDocument(
      [{ quantityMilli: 1000n, unitPrice: paise(1_05n), rateBps: 1800 }],
      intra
    )
    // tax on ₹1.05 = 18.9 → 19 paise: CGST 10, SGST 9
    expect(totals).toMatchObject({ cgst: 10n, sgst: 9n, igst: 0n })
  })

  it("charges IGST interstate and nothing when GST isn't charged", () => {
    const line = {
      quantityMilli: 1000n,
      unitPrice: paise(100_00n),
      rateBps: 1800,
    }
    expect(
      computeDocument([line], { intrastate: false, chargesGst: true }).totals
    ).toMatchObject({ igst: 18_00n, cgst: 0n, total: 118_00n })
    expect(
      computeDocument([line], { intrastate: false, chargesGst: false }).totals
    ).toMatchObject({ igst: 0n, total: 100_00n })
  })

  it("hits an exact target total through Round-off", () => {
    // Refund of ₹999.50 at 18%: taxable 847.03, tax 152.47 → exact 999.50
    const { totals } = computeDocument(
      [{ quantityMilli: 1000n, unitPrice: paise(847_03n), rateBps: 1800 }],
      intra,
      { exactTotal: paise(999_50n) }
    )
    expect(totals.total).toBe(999_50n)
    expect(totals.taxable + totals.cgst + totals.sgst + totals.roundOff).toBe(
      999_50n
    )
  })

  it("refuses a target more than 50 paise away", () => {
    expect(() =>
      computeDocument(
        [{ quantityMilli: 1000n, unitPrice: paise(100_00n), rateBps: 1800 }],
        intra,
        { exactTotal: paise(119_00n) }
      )
    ).toThrow(InvalidMoneyError)
  })
})
