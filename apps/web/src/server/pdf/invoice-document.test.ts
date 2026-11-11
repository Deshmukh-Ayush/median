import { inflateSync } from "node:zlib"

import { describe, expect, it } from "vitest"

import { paise } from "@workspace/ledger"

import type { Invoice } from "@/server/services"

import {
  exportEndorsement,
  invoiceDocument,
  supplyLabel,
} from "./invoice-document"

const p = (n: bigint) => paise(n)

const invoice: Invoice = {
  id: "00000000-0000-4000-8000-000000000001",
  number: "INV/2026-27/0001",
  financialYear: "2026-27",
  party: {
    id: "p1",
    name: "Acme Traders",
    gstin: "27AAPFU0939F1ZV",
    address: "12 MG Road, Pune 411001",
    stateCode: "27",
  },
  invoiceDate: "2026-11-07",
  dueDate: "2026-12-07",
  placeOfSupply: "27",
  supplyType: "intrastate",
  reverseCharge: false,
  lines: [
    {
      id: "l1",
      description: "Consulting",
      hsnSac: "998311",
      quantity: "1",
      unitPrice: p(12345678_00n),
      gstRateBps: 1800,
      taxable: p(12345678_00n),
      cgst: p(1111111_02n),
      sgst: p(1111111_02n),
      igst: p(0n),
      total: p(14567900_04n),
    },
  ],
  taxable: p(12345678_00n),
  cgst: p(1111111_02n),
  sgst: p(1111111_02n),
  igst: p(0n),
  roundOff: p(-4n),
  total: p(14567900_00n),
  paid: p(0n),
  credited: p(0n),
  outstanding: p(14567900_00n),
  status: "issued",
  notes: null,
  journalEntryId: null,
  createdAt: "2026-11-07T10:00:00.000Z",
}

/** Every stream in the PDF, inflated where it's Flate-compressed. */
function pdfText(buffer: Buffer): string {
  const raw = buffer.toString("latin1")
  const parts = [raw]
  const re = /stream\r?\n/g
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const start = m.index + m[0].length
    const end = raw.indexOf("endstream", start)
    if (end < 0) break
    try {
      parts.push(inflateSync(buffer.subarray(start, end)).toString("latin1"))
    } catch {
      // Not compressed, or not Flate: the raw text already covers it.
    }
  }
  return parts.join("\n")
}

describe("invoiceDocument", () => {
  it("embeds Noto Sans and prints the ₹ glyph, not Rs.", async () => {
    const pdf = await import("@react-pdf/renderer")
    const buffer = await pdf.renderToBuffer(
      invoiceDocument({
        pdf,
        invoice,
        supplier: { name: "Median Demo", gstin: null, stateCode: "27" },
      })
    )
    const text = pdfText(buffer)
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Regular/)
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Bold/)
    expect(text).not.toContain("Helvetica")
    // The subset's ToUnicode map has an entry for U+20B9 (₹).
    expect(text.toLowerCase()).toContain("<20b9>")
  }, 30_000)

  it.each([
    ["intrastate", false],
    ["interstate", false],
    ["export_with_payment", true],
    ["export_lut", true],
    ["sez", true],
  ] as const)(
    "renders a %s invoice",
    async (supplyType, endorsed) => {
      const pdf = await import("@react-pdf/renderer")
      const buffer = await pdf.renderToBuffer(
        invoiceDocument({
          pdf,
          invoice: {
            ...invoice,
            supplyType,
            placeOfSupply: supplyType.startsWith("export") ? "96" : "27",
            reverseCharge: supplyType === "interstate",
          },
          supplier: { name: "Median Demo", gstin: null, stateCode: "29" },
        })
      )
      expect(buffer.subarray(0, 5).toString()).toBe("%PDF-")
      expect(exportEndorsement(supplyType) !== null).toBe(endorsed)
    },
    30_000
  )
})

describe("supply labels", () => {
  it("names each supply type", () => {
    expect(supplyLabel("intrastate")).toBe("Intra-state (CGST + SGST)")
    expect(supplyLabel("export_lut")).toContain("LUT")
    expect(supplyLabel("sez")).toContain("SEZ")
  })

  it("endorses exports and SEZ supplies per rule 46", () => {
    expect(exportEndorsement("export_lut")).toMatch(
      /UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX$/
    )
    expect(exportEndorsement("export_with_payment")).toMatch(
      /ON PAYMENT OF INTEGRATED TAX$/
    )
    expect(exportEndorsement("sez")).toMatch(/ON PAYMENT OF INTEGRATED TAX$/)
    expect(exportEndorsement("interstate")).toBeNull()
  })
})
