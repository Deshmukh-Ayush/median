import { describe, expect, it } from "vitest"

import { billExtractionSchema } from "@/server/services/extraction"

import {
  type AiBillExtraction,
  aiBillExtractionSchema,
  flagLowConfidence,
} from "./bill-extraction"

function sampleBill(): AiBillExtraction {
  return {
    vendor: {
      name: "Lotus Peak Cloud Pvt Ltd",
      gstin: "29AAACL1234F1Z5",
      stateCode: "29",
    },
    billNumber: "LPC/26-27/0412",
    billDate: "2026-10-05",
    dueDate: null,
    placeOfSupply: "Karnataka (29)",
    placeOfSupplyStateCode: "29",
    currency: "INR",
    lines: [
      {
        description: "Managed hosting, October",
        hsnSac: "998315",
        quantity: "1",
        rate: "25,000.00",
        taxableAmount: "25,000.00",
        gstRatePercent: "18",
        cgstAmount: "2,250.00",
        sgstAmount: "2,250.00",
        igstAmount: null,
      },
    ],
    printedTotals: {
      taxable: "25,000.00",
      cgst: "2,250.00",
      sgst: "2,250.00",
      igst: null,
      total: "29,500.00",
    },
    lowConfidenceFields: [],
  }
}

describe("aiBillExtractionSchema", () => {
  it("produces a valid BillExtraction for the inbox contract", () => {
    const ai = aiBillExtractionSchema.parse(sampleBill())
    expect(billExtractionSchema.safeParse(ai).success).toBe(true)
  })

  it("requires at least one line", () => {
    const bill = { ...sampleBill(), lines: [] }
    expect(aiBillExtractionSchema.safeParse(bill).success).toBe(false)
  })
})

describe("flagLowConfidence", () => {
  it("adds nothing for a clean bill", () => {
    expect(flagLowConfidence(sampleBill())).toEqual([])
  })

  it("keeps the model's own flags", () => {
    const bill = sampleBill()
    bill.lowConfidenceFields = [{ field: "billNumber", reason: "blurred" }]
    expect(flagLowConfidence(bill)).toEqual([
      { field: "billNumber", reason: "blurred" },
    ])
  })

  it("flags missing HSN, rate and total", () => {
    const bill = sampleBill()
    const [line] = bill.lines
    if (!line) throw new Error("fixture has a line")
    line.hsnSac = null
    line.gstRatePercent = null
    bill.printedTotals.total = null
    expect(flagLowConfidence(bill).map((f) => f.field)).toEqual([
      "printedTotals.total",
      "lines[0].hsnSac",
      "lines[0].gstRatePercent",
    ])
  })

  it("flags malformed GSTIN, date and state code", () => {
    const bill = sampleBill()
    bill.vendor.gstin = "29AAACL1234"
    bill.billDate = "05/10/2026"
    bill.placeOfSupplyStateCode = "Karnataka"
    expect(flagLowConfidence(bill).map((f) => f.field)).toEqual([
      "vendor.gstin",
      "billDate",
      "placeOfSupplyStateCode",
    ])
  })

  it("does not duplicate a field the model already flagged", () => {
    const bill = sampleBill()
    bill.vendor.gstin = null
    bill.lowConfidenceFields = [{ field: "vendor.gstin", reason: "smudged" }]
    expect(flagLowConfidence(bill)).toEqual([
      { field: "vendor.gstin", reason: "smudged" },
    ])
  })
})
