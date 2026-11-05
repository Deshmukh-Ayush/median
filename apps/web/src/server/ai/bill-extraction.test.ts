import { describe, expect, it } from "vitest"

import { billExtractionSchema } from "@/server/services/extraction"

import {
  type AiBillExtraction,
  aiBillExtractionSchema,
} from "./bill-extraction"

function sampleBill(): AiBillExtraction {
  return {
    vendor: {
      name: "Lotus Peak Cloud Pvt Ltd",
      gstin: "29AAACL4417K1ZD",
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
