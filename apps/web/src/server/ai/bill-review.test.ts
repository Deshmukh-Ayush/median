import { isStandardGstSlab as contractsSlabCheck } from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import type { AiBillExtraction } from "./bill-extraction"
import { reviewBill } from "./bill-review"

const TODAY = "2026-11-06"

/** A consistent intra-state bill: 2 lines, 18% and 5%, round-off +0.10. */
function bill(): AiBillExtraction {
  return {
    vendor: {
      name: "Lotus Peak Cloud Pvt Ltd",
      gstin: "29AAACL4417K1ZD",
      stateCode: "29",
    },
    billNumber: "LPC/26-27/0412",
    billDate: "2026-10-05",
    dueDate: "2026-11-04",
    placeOfSupply: "Karnataka (29)",
    placeOfSupplyStateCode: "29",
    currency: "INR",
    lines: [
      {
        description: "Managed hosting",
        hsnSac: "998315",
        quantity: "2.5",
        rate: "10,000.00",
        taxableAmount: "25,000.00",
        gstRatePercent: "18",
        cgstAmount: "2,250.00",
        sgstAmount: "2,250.00",
        igstAmount: null,
      },
      {
        description: "Printed brochures",
        hsnSac: "49011010",
        quantity: "100",
        rate: "12.50",
        taxableAmount: "1,250.00",
        gstRatePercent: "5",
        cgstAmount: "31.25",
        sgstAmount: "31.25",
        igstAmount: null,
      },
    ],
    printedTotals: {
      taxable: "26,250.00",
      cgst: "2,281.25",
      sgst: "2,281.25",
      igst: null,
      total: "30,812.00",
    },
    lowConfidenceFields: [],
  }
}

const reviewFields = (b: AiBillExtraction) =>
  reviewBill(b, TODAY).needsReview.map((f) => f.field)

describe("reviewBill", () => {
  it("passes a consistent bill with nothing to review", () => {
    expect(reviewBill(bill(), TODAY)).toEqual({
      needsReview: [],
      notPrinted: [],
    })
  })

  it("never changes the extraction", () => {
    const b = bill()
    b.printedTotals.total = "99,999.00"
    const before = JSON.stringify(b)
    reviewBill(b, TODAY)
    expect(JSON.stringify(b)).toBe(before)
  })

  it("flags a GSTIN that fails its checksum", () => {
    const b = bill()
    b.vendor.gstin = "29AAACL4411K1ZD"
    const flag = reviewBill(b, TODAY).needsReview.find(
      (f) => f.field === "vendor.gstin"
    )
    expect(flag?.reason).toMatch(/check digit/)
  })

  it("flags a missing GSTIN for review, not as informational", () => {
    const b = bill()
    b.vendor.gstin = null
    expect(reviewFields(b)).toContain("vendor.gstin")
  })

  it("flags IGST charged when vendor and place of supply are the same state", () => {
    const b = bill()
    b.printedTotals.igst = "4,562.50"
    expect(reviewFields(b)).toContain("placeOfSupplyStateCode")
  })

  it("flags CGST/SGST charged across states", () => {
    const b = bill()
    b.placeOfSupplyStateCode = "27"
    b.placeOfSupply = "Maharashtra (27)"
    expect(reviewFields(b)).toEqual(["placeOfSupplyStateCode"])
  })

  it("flags a state code that disagrees with the printed place of supply", () => {
    const b = bill()
    b.placeOfSupply = "Karnataka (28)"
    expect(reviewFields(b)).toEqual(["placeOfSupplyStateCode"])
  })

  it("flags HSN/SAC codes that aren't 4, 6 or 8 digits", () => {
    const b = bill()
    const [first, second] = b.lines
    if (!first || !second) throw new Error("fixture")
    first.hsnSac = "99831"
    second.hsnSac = "4901 1010"
    expect(reviewFields(b)).toEqual(["lines[0].hsnSac"])
  })

  it("flags invalid and future dates", () => {
    const b = bill()
    b.billDate = "2026-02-30"
    expect(reviewFields(b)).toContain("billDate")
    b.billDate = "2026-12-01"
    expect(reviewFields(b)).toContain("billDate")
  })

  it("flags printed totals that don't add up, without replacing them", () => {
    const b = bill()
    b.printedTotals.total = "30,912.00"
    const flag = reviewBill(b, TODAY).needsReview.find(
      (f) => f.field === "printedTotals.total"
    )
    expect(flag?.reason).toMatch(/30812\.50/)
    expect(b.printedTotals.total).toBe("30,912.00")
  })

  it("flags line taxable values that don't add up to the printed subtotal", () => {
    const b = bill()
    b.printedTotals.taxable = "26,350.00"
    expect(reviewFields(b)).toContain("printedTotals.taxable")
  })

  it("flags a line where quantity × rate isn't the taxable value", () => {
    const b = bill()
    const [first] = b.lines
    if (!first) throw new Error("fixture")
    first.rate = "16,000.00"
    expect(reviewFields(b)).toEqual(["lines[0].taxableAmount"])
  })

  it("flags a misread GST rate via the taxes", () => {
    const b = bill()
    const [, second] = b.lines
    if (!second) throw new Error("fixture")
    second.gstRatePercent = "18"
    expect(reviewFields(b)).toContain("lines[1].cgstAmount")
  })

  it("puts values that aren't printed in notPrinted only", () => {
    const b = bill()
    b.dueDate = null
    const [first] = b.lines
    if (!first) throw new Error("fixture")
    first.hsnSac = null
    b.lowConfidenceFields = [{ field: "dueDate", reason: "not printed" }]
    const result = reviewBill(b, TODAY)
    expect(result.needsReview).toEqual([])
    expect(result.notPrinted.map((f) => f.field)).toEqual([
      "dueDate",
      "lines[0].hsnSac",
    ])
  })

  it("keeps the model's flags on printed values as needs_review", () => {
    const b = bill()
    b.lowConfidenceFields = [{ field: "billNumber", reason: "blurred" }]
    expect(reviewBill(b, TODAY).needsReview).toEqual([
      {
        field: "billNumber",
        kind: "needs_review",
        reason: "model: blurred",
        source: "model",
      },
    ])
  })
})

describe("reviewBill: GST rate on the bill date", () => {
  // Stand-in for isStandardGstSlab from contracts: same slab periods.
  const isStandardGstSlab = (rateBps: number, date: string) =>
    (date <= "2025-09-21"
      ? [0, 500, 1200, 1800, 2800]
      : [0, 500, 1800, 4000]
    ).includes(rateBps)
  const rateFlags = (b: AiBillExtraction) =>
    reviewBill(b, TODAY, { isStandardGstSlab }).needsReview.filter((f) =>
      f.field.endsWith("gstRatePercent")
    )

  /** The sample bill with line 0 at `percent` (only the rate flag is read). */
  function billAt(percent: string, date: string): AiBillExtraction {
    const b = bill()
    b.billDate = date
    b.dueDate = null
    b.lines[0]!.gstRatePercent = percent
    return b
  }

  it("accepts rates that are slabs on the bill date", () => {
    expect(rateFlags(bill())).toEqual([])
  })

  it("flags 12% on a bill after the slabs changed", () => {
    expect(rateFlags(billAt("12", "2025-10-01"))).toEqual([
      expect.objectContaining({
        field: "lines[0].gstRatePercent",
        kind: "needs_review",
        source: "check",
      }),
    ])
  })

  it("accepts 12% on a bill dated before the change", () => {
    expect(rateFlags(billAt("12", "2025-09-21"))).toEqual([])
  })

  it("flags 40% before it existed", () => {
    expect(rateFlags(billAt("40", "2025-09-21"))).toHaveLength(1)
  })

  it("flags a special rate for review rather than failing it", () => {
    const [flag] = rateFlags(billAt("3", "2026-01-15"))
    expect(flag?.kind).toBe("needs_review")
    expect(flag?.reason).toMatch(/special rate/)
  })

  it("flags a rate finer than a basis point", () => {
    expect(rateFlags(billAt("18.005", "2026-01-15"))).toHaveLength(1)
  })

  it("skips the check without a slab list", () => {
    const b = billAt("12", "2025-10-01")
    expect(
      reviewBill(b, TODAY).needsReview.filter((f) =>
        f.field.endsWith("gstRatePercent")
      )
    ).toEqual([])
  })

  it("skips the check when the bill date is invalid", () => {
    expect(rateFlags(billAt("12", "05/10/2025"))).toEqual([])
  })
})

describe("reviewBill with the contracts slab list", () => {
  it("flags 12% after 22 Sep 2025 using isStandardGstSlab", () => {
    const b = bill()
    b.lines[0]!.gstRatePercent = "12"
    expect(
      reviewBill(b, TODAY, {
        isStandardGstSlab: contractsSlabCheck,
      }).needsReview.map((f) => f.field)
    ).toContain("lines[0].gstRatePercent")
  })
})
