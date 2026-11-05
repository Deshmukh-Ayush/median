import { describe, expect, it } from "vitest"

import {
  computeLine,
  documentTotals,
  financialYearOf,
  isValidDocumentNumber,
  lineTaxable,
  matchTdsReceipt,
  resolveSupply,
  splitInclusive,
  splitTax,
  taxOn,
} from "./gst"
import { InvalidMoneyError, paise } from "./money"

describe("rule 6: supply type", () => {
  it("same state is intrastate, different state is interstate", () => {
    expect(
      resolveSupply({ orgStateCode: "29", placeOfSupply: "29" })
    ).toMatchObject({
      supplyType: "intrastate",
      intrastate: true,
      chargesGst: true,
    })
    expect(
      resolveSupply({ orgStateCode: "29", placeOfSupply: "27" })
    ).toMatchObject({
      supplyType: "interstate",
      intrastate: false,
    })
  })

  it("unknown B2C place of supply uses the org's state", () => {
    expect(
      resolveSupply({ orgStateCode: "29", placeOfSupply: null })
    ).toMatchObject({
      supplyType: "intrastate",
      placeOfSupply: "29",
    })
  })

  it("exports and SEZ are IGST; export under LUT is zero-rated", () => {
    const base = { orgStateCode: "29", placeOfSupply: "29" }
    expect(
      resolveSupply({ ...base, special: "export_with_payment" })
    ).toMatchObject({
      intrastate: false,
      chargesGst: true,
    })
    expect(resolveSupply({ ...base, special: "export_lut" })).toMatchObject({
      intrastate: false,
      chargesGst: false,
    })
    expect(resolveSupply({ ...base, special: "sez" })).toMatchObject({
      supplyType: "sez",
      intrastate: false,
    })
  })

  it("splits intrastate tax in halves with the odd paisa on CGST", () => {
    expect(splitTax(paise(1_801n), true)).toEqual({
      cgst: 901n,
      sgst: 900n,
      igst: 0n,
    })
    expect(splitTax(paise(1_800n), true)).toEqual({
      cgst: 900n,
      sgst: 900n,
      igst: 0n,
    })
    expect(splitTax(paise(1_801n), false)).toEqual({
      cgst: 0n,
      sgst: 0n,
      igst: 1_801n,
    })
  })
})

describe("rule 7: per-line GST and rupee rounding", () => {
  it("computes tax per line in paise, rounding half up", () => {
    expect(taxOn(paise(1_00_000n), 1800)).toBe(18_000n)
    expect(taxOn(paise(25n), 1800)).toBe(5n) // 4.5 → 5
    expect(taxOn(paise(1n), 25)).toBe(0n)
  })

  it("multiplies fractional quantities exactly", () => {
    expect(
      lineTaxable({ quantityMilli: 12_500n, unitPrice: paise(2_000_00n) })
    ).toBe(25_000_00n)
    expect(lineTaxable({ quantityMilli: 1_333n, unitPrice: paise(100n) })).toBe(
      133n
    )
  })

  it("charges nothing when the supply doesn't charge GST", () => {
    const line = computeLine(
      { quantityMilli: 1_000n, unitPrice: paise(10_000_00n), rateBps: 1800 },
      { intrastate: false, chargesGst: false }
    )
    expect(line).toEqual({
      taxable: 10_000_00n,
      cgst: 0n,
      sgst: 0n,
      igst: 0n,
      total: 10_000_00n,
    })
  })

  it("rounds the document total to the rupee and reports the round-off", () => {
    const supply = { intrastate: true, chargesGst: true }
    const lines = [
      computeLine(
        { quantityMilli: 1_000n, unitPrice: paise(999_99n), rateBps: 1800 },
        supply
      ),
      computeLine(
        { quantityMilli: 3_000n, unitPrice: paise(33_33n), rateBps: 500 },
        supply
      ),
    ]
    const totals = documentTotals(lines)
    const exact = lines.reduce((s, l) => s + l.total, 0n)
    expect(totals.total % 100n).toBe(0n)
    expect(totals.total - exact).toBe(totals.roundOff)
    expect(totals.roundOff >= -50n && totals.roundOff <= 50n).toBe(true)
    expect(totals.total).toBe(
      totals.taxable + totals.cgst + totals.sgst + totals.igst + totals.roundOff
    )
  })

  it("rounds 50 paise up and 49 paise down", () => {
    const line = (total: bigint) => ({
      taxable: paise(total),
      cgst: paise(0n),
      sgst: paise(0n),
      igst: paise(0n),
      total: paise(total),
    })
    expect(documentTotals([line(100_50n)])).toMatchObject({
      total: 101_00n,
      roundOff: 50n,
    })
    expect(documentTotals([line(100_49n)])).toMatchObject({
      total: 100_00n,
      roundOff: -49n,
    })
  })
})

describe("rule 8: GST-inclusive amounts", () => {
  it("splits 118 at 18% into 100 + 18", () => {
    expect(splitInclusive(paise(118_00n), 1800)).toEqual({
      taxable: 100_00n,
      gst: 18_00n,
    })
  })

  it("rounds the taxable value and gives the remainder to GST", () => {
    const { taxable, gst } = splitInclusive(paise(99_99n), 1800)
    expect(taxable).toBe(84_74n) // 9999 / 1.18 = 8473.7…
    expect(taxable + gst).toBe(99_99n)
  })

  it("returns the whole amount as taxable at 0%", () => {
    expect(splitInclusive(paise(5_00n), 0)).toEqual({ taxable: 5_00n, gst: 0n })
  })

  it("rejects bad rates and negative amounts", () => {
    expect(() => splitInclusive(paise(100n), 18.5)).toThrow(InvalidMoneyError)
    expect(() => splitInclusive(paise(-1n), 1800)).toThrow(InvalidMoneyError)
  })
})

describe("rule 11: TDS on receipts", () => {
  const invoice = {
    invoiceTotal: paise(1_18_000_00n),
    taxable: paise(1_00_000_00n),
  }

  it.each([
    [100, 1_17_000_00n, 1_000_00n],
    [200, 1_16_000_00n, 2_000_00n],
    [1000, 1_08_000_00n, 10_000_00n],
  ])(
    "matches a receipt short by %i bps of the taxable value",
    (rateBps, received, tds) => {
      expect(
        matchTdsReceipt({ ...invoice, received: paise(received) })
      ).toEqual({
        rateBps,
        tds,
        expectedReceipt: received,
      })
    }
  )

  it("doesn't match other shortfalls or full payment", () => {
    expect(
      matchTdsReceipt({ ...invoice, received: paise(1_15_000_00n) })
    ).toBeNull()
    expect(
      matchTdsReceipt({ ...invoice, received: invoice.invoiceTotal })
    ).toBeNull()
  })
})

describe("rule 5: financial year and numbering", () => {
  it("runs April to March", () => {
    expect(financialYearOf("2026-04-01")).toBe("2026-27")
    expect(financialYearOf("2027-03-31")).toBe("2026-27")
    expect(financialYearOf("2099-12-31")).toBe("2099-00")
  })

  it("allows document numbers of 1–16 characters", () => {
    expect(isValidDocumentNumber("INV/2026-27/0042")).toBe(true)
    expect(isValidDocumentNumber("INV/2026-27/00042")).toBe(false)
    expect(isValidDocumentNumber("")).toBe(false)
  })
})
