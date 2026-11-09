import { ServiceError } from "@workspace/contracts"
import { computeDocument, paise } from "@workspace/ledger"
import { describe, expect, it } from "vitest"

import {
  buildInvoice,
  documentNumber,
  invoiceStatusFor,
  outstandingOf,
  planCreditLines,
  planRefundCredit,
  receiptAmount,
  salesEntryLines,
} from "./invoice-build"

const org = { stateCode: "29", gstRegistered: true, compositionScheme: false }
const b2b = { stateCode: "29", gstin: "29AAICA3918J1ZE" }
const line = (
  over: Partial<Parameters<typeof buildInvoice>[0]["lines"][number]> = {}
) => ({
  description: "Growth plan",
  hsnSac: "998314",
  quantity: "1",
  unitPrice: paise(1_00_000_00n),
  gstRateBps: 1800,
  ...over,
})
const accounts = {
  receivables: "ar",
  revenue: "rev",
  outputCgst: "ocgst",
  outputSgst: "osgst",
  outputIgst: "oigst",
  roundOff: "ro",
}

/** "Dr ar" / "Cr rev:1800" → amount, for compact assertions. */
function summary(lines: ReturnType<typeof salesEntryLines>) {
  return Object.fromEntries(
    lines.map((l) => [
      `${l.debit > 0n ? "Dr" : "Cr"} ${l.accountId}${l.dimensions?.["gst_rate_bps"] ? `:${l.dimensions["gst_rate_bps"]}` : ""}`,
      l.debit > 0n ? l.debit : l.credit,
    ])
  )
}

describe("buildInvoice (rule 6: supply type)", () => {
  it("same state → CGST + SGST", () => {
    const b = buildInvoice({ reverseCharge: false, lines: [line()] }, org, b2b)
    expect(b).toMatchObject({ supplyType: "intrastate", placeOfSupply: "29" })
    expect(b.totals).toMatchObject({
      cgst: 9_000_00n,
      sgst: 9_000_00n,
      igst: 0n,
      total: 1_18_000_00n,
    })
  })

  it("defaults the place of supply to the customer's state → IGST", () => {
    const b = buildInvoice({ reverseCharge: false, lines: [line()] }, org, {
      stateCode: "27",
      gstin: null,
    })
    expect(b).toMatchObject({ supplyType: "interstate", placeOfSupply: "27" })
    expect(b.totals.igst).toBe(18_000_00n)
  })

  it("unknown B2C place of supply → the org's state", () => {
    const b = buildInvoice({ reverseCharge: false, lines: [line()] }, org, {
      stateCode: null,
      gstin: null,
    })
    expect(b).toMatchObject({ placeOfSupply: "29", supplyType: "intrastate" })
  })

  it("an explicit place of supply wins", () => {
    const b = buildInvoice(
      { placeOfSupply: "07", reverseCharge: false, lines: [line()] },
      org,
      b2b
    )
    expect(b.supplyType).toBe("interstate")
  })

  it("export under LUT is zero-rated with place of supply 96", () => {
    const b = buildInvoice(
      { specialSupply: "export_lut", reverseCharge: false, lines: [line()] },
      org,
      { stateCode: null, gstin: null }
    )
    expect(b).toMatchObject({
      supplyType: "export_lut",
      placeOfSupply: "96",
      chargesGst: false,
    })
    expect(b.totals.total).toBe(1_00_000_00n)
    expect(b.warnings).toEqual([])
  })

  it("export with payment and SEZ charge IGST even in the same state", () => {
    for (const special of ["export_with_payment", "sez"] as const) {
      const b = buildInvoice(
        {
          specialSupply: special,
          placeOfSupply: "29",
          reverseCharge: false,
          lines: [line()],
        },
        org,
        b2b
      )
      expect(b.totals).toMatchObject({ igst: 18_000_00n, cgst: 0n })
    }
  })

  it("reverse charge charges no GST but keeps the supply type", () => {
    const b = buildInvoice({ reverseCharge: true, lines: [line()] }, org, {
      stateCode: "27",
      gstin: null,
    })
    expect(b).toMatchObject({ supplyType: "interstate", chargesGst: false })
    expect(b.totals.total).toBe(1_00_000_00n)
    expect(b.warnings).toContain(
      "Reverse charge applies only to GST-registered customers."
    )
  })

  it("unregistered and composition businesses issue bills of supply", () => {
    for (const o of [
      { ...org, gstRegistered: false },
      { ...org, compositionScheme: true },
    ]) {
      const b = buildInvoice({ reverseCharge: false, lines: [line()] }, o, b2b)
      expect(b.chargesGst).toBe(false)
      expect(b.totals.total).toBe(1_00_000_00n)
      expect(b.warnings[0]).toMatch(/bill of supply/)
    }
  })

  it("needs a state to compare against, and a non-zero total", () => {
    expect(() =>
      buildInvoice(
        { reverseCharge: false, lines: [line()] },
        { ...org, stateCode: null },
        b2b
      )
    ).toThrow(ServiceError)
    expect(() =>
      buildInvoice(
        { reverseCharge: false, lines: [line({ unitPrice: paise(0n) })] },
        org,
        b2b
      )
    ).toThrow(/₹0/)
  })
})

describe("buildInvoice (rule 7: per-line GST, rupee rounding)", () => {
  it("computes each line, then rounds the total", () => {
    const b = buildInvoice(
      {
        reverseCharge: false,
        lines: [
          line({ quantity: "2.5", unitPrice: paise(333_33n) }), // 833.33 → tax 150.00
          line({ unitPrice: paise(99_99n), gstRateBps: 500 }), // 99.99 → tax 5.00
        ],
      },
      org,
      b2b
    )
    expect(
      b.lines.map((l) => [l.quantityMilli, l.taxable, l.cgst + l.sgst])
    ).toEqual([
      [2500n, 833_33n, 150_00n],
      [1000n, 99_99n, 5_00n],
    ])
    // exact 1088.32 → 1088.00, round-off −0.32
    expect(b.totals).toMatchObject({
      taxable: 933_32n,
      total: 1088_00n,
      roundOff: -32n,
    })
  })
})

describe("salesEntryLines", () => {
  const built = buildInvoice(
    {
      reverseCharge: false,
      lines: [
        line({ unitPrice: paise(1_000_00n) }),
        line({ unitPrice: paise(500_00n), gstRateBps: 500 }),
        line({ unitPrice: paise(10_10n), revenueAccountId: "services" }),
      ],
    },
    org,
    b2b
  )
  const ref = {
    partyId: "acme",
    documentId: "inv_1",
    number: "INV/2026-27/0001",
  }

  it("invoice: Dr receivables; Cr revenue per account and rate, output GST, round-off", () => {
    const lines = salesEntryLines("invoice", built, accounts, ref)
    // taxable 1510.10; tax 180 + 25 + 1.82 = 206.82; exact 1716.92 → 1717
    expect(summary(lines)).toEqual({
      "Dr ar": 1717_00n,
      "Cr rev:1800": 1_000_00n,
      "Cr rev:500": 500_00n,
      "Cr services:1800": 10_10n,
      "Cr ocgst": 103_41n,
      "Cr osgst": 103_41n,
      "Cr ro": 8n,
    })
    const debit = lines.reduce((s, l) => s + l.debit, 0n)
    const credit = lines.reduce((s, l) => s + l.credit, 0n)
    expect(debit).toBe(credit)
    expect(lines[0]).toMatchObject({
      partyId: "acme",
      dimensions: { invoice_id: "inv_1" },
    })
  })

  it("credit note: the exact mirror", () => {
    const inv = salesEntryLines("invoice", built, accounts, ref)
    const cn = salesEntryLines("credit_note", built, accounts, {
      ...ref,
      documentId: "cn_1",
    })
    expect(cn.map((l) => [l.accountId, l.debit, l.credit])).toEqual(
      inv.map((l) => [l.accountId, l.credit, l.debit])
    )
    expect(cn[0]?.dimensions).toEqual({ credit_note_id: "cn_1" })
  })

  it("a negative round-off is a debit on an invoice", () => {
    const b = buildInvoice(
      {
        reverseCharge: false,
        lines: [line({ unitPrice: paise(99_99n), gstRateBps: 500 })],
      },
      org,
      b2b
    )
    // 99.99 + 5.00 = 104.99 → 105.00 (+1). Use 2 × 50.10 at 0%: 100.20 → 100 (−20)
    const neg = buildInvoice(
      {
        reverseCharge: false,
        lines: [
          line({ quantity: "2", unitPrice: paise(50_10n), gstRateBps: 0 }),
        ],
      },
      org,
      b2b
    )
    expect(summary(salesEntryLines("invoice", b, accounts, ref))["Cr ro"]).toBe(
      1n
    )
    expect(summary(salesEntryLines("invoice", neg, accounts, ref))).toEqual({
      "Dr ar": 100_00n,
      "Cr rev:0": 100_20n,
      "Dr ro": 20n,
    })
  })
})

describe("numbering (rule 5)", () => {
  it("pads to four digits and stays within 16 characters", () => {
    expect(documentNumber("INV", "2026-27", 42)).toBe("INV/2026-27/0042")
    expect(documentNumber("CN", "2026-27", 1)).toBe("CN/2026-27/0001")
    expect(documentNumber("INV", "2026-27", 10_000)).toBe("INV202627-10000")
    expect(() => documentNumber("INVOICE", "2026-27", 100_000)).toThrow(
      ServiceError
    )
  })
})

describe("outstanding and status", () => {
  it.each([
    [118n, 0n, 0n, 118n, "issued"],
    [118n, 18n, 0n, 100n, "partially_paid"],
    [118n, 118n, 0n, 0n, "paid"],
    [118n, 0n, 118n, 0n, "cancelled"],
    [118n, 0n, 18n, 100n, "issued"],
    // Paid, then refunded with a credit note: nothing left either way.
    [118n, 118n, 59n, 0n, "paid"],
  ] as const)(
    "total %i, paid %i, credited %i → %i %s",
    (total, paid, credited, left, status) => {
      expect(outstandingOf(total, paid, credited)).toBe(left)
      expect(invoiceStatusFor(total, paid, credited)).toBe(status)
    }
  )

  it("a receipt counts what it credits to that customer's receivable", () => {
    expect(
      receiptAmount(
        [
          { accountId: "bank", partyId: null, credit: 0n },
          { accountId: "ar", partyId: "acme", credit: 1_18_000_00n },
          { accountId: "ar", partyId: "other", credit: 5n },
        ],
        "ar",
        "acme"
      )
    ).toBe(1_18_000_00n)
  })
})

describe("credit notes: planCreditLines", () => {
  const inv = [
    {
      id: "l1",
      lineNo: 1,
      description: "Seats",
      hsnSac: "998314",
      quantityMilli: 10_000n,
      unitPrice: paise(1_000_00n),
      gstRateBps: 1800,
      revenueAccountId: "services",
      taxable: paise(10_000_00n),
      creditedTaxable: paise(2_000_00n),
    },
  ]

  it("credits a returned quantity at the invoice price, keeping the line's account", () => {
    expect(
      planCreditLines(inv, [{ invoiceLineId: "l1", quantityMilli: 3000n }])
    ).toEqual([
      expect.objectContaining({
        invoiceLineId: "l1",
        quantityMilli: 3000n,
        unitPrice: 1_000_00n,
        gstRateBps: 1800,
        revenueAccountId: "services",
      }),
    ])
  })

  it("credits a value as one unit of that value, marked by value", () => {
    expect(
      planCreditLines(inv, [
        { invoiceLineId: "l1", taxable: paise(500_00n) },
      ])[0]
    ).toMatchObject({
      quantityMilli: 1000n,
      unitPrice: 500_00n,
      byValue: true,
    })
    // A returned quantity is not by value, so it keeps its units.
    expect(
      planCreditLines(inv, [{ invoiceLineId: "l1", quantityMilli: 1000n }])[0]
        ?.byValue
    ).toBe(false)
  })

  it("refuses more than what's left on the line, across requests", () => {
    // ₹8,000 left: 5 seats + ₹3,000.01 is too much.
    expect(() =>
      planCreditLines(inv, [
        { invoiceLineId: "l1", quantityMilli: 5000n },
        { invoiceLineId: "l1", taxable: paise(3_000_01n) },
      ])
    ).toThrow(/Line 1 has only ₹8,000\.00 left/)
    expect(() =>
      planCreditLines(inv, [{ invoiceLineId: "nope", quantityMilli: 1000n }])
    ).toThrow(ServiceError)
  })
})

describe("credit notes: planRefundCredit (rule 10)", () => {
  const supply = { intrastate: true, chargesGst: true }
  const line = (id: string, taxable: bigint, rate = 1800, credited = 0n) => ({
    id,
    lineNo: Number(id.slice(1)),
    description: id,
    hsnSac: "998314",
    quantityMilli: 1000n,
    unitPrice: paise(taxable),
    gstRateBps: rate,
    revenueAccountId: null,
    taxable: paise(taxable),
    creditedTaxable: paise(credited),
  })

  it("a refund of everything left credits every line in full", () => {
    const plan = planRefundCredit(
      [line("l1", 1_000_00n), line("l2", 500_00n, 500)],
      paise(1_705_00n),
      supply
    )
    expect(plan).toEqual({
      ok: true,
      requests: [
        { invoiceLineId: "l1", taxable: 1_000_00n },
        { invoiceLineId: "l2", taxable: 500_00n },
      ],
    })
  })

  it("a partial refund at one rate splits by what's left on each line", () => {
    // ₹590 at 18% → taxable 500, split 3:1 by what's left (1500 vs 500).
    const plan = planRefundCredit(
      [line("l1", 2_000_00n, 1800, 500_00n), line("l2", 500_00n)],
      paise(590_00n),
      supply
    )
    expect(plan).toEqual({
      ok: true,
      requests: [
        { invoiceLineId: "l1", taxable: 375_00n },
        { invoiceLineId: "l2", taxable: 125_00n },
      ],
    })
    if (!plan.ok) return
    // The credit note then hits the refund exactly.
    const planned = planCreditLines(
      [line("l1", 2_000_00n, 1800, 500_00n), line("l2", 500_00n)],
      plan.requests
    )
    const { totals } = computeDocument(
      planned.map((l) => ({
        quantityMilli: l.quantityMilli,
        unitPrice: l.unitPrice,
        rateBps: l.gstRateBps,
      })),
      supply,
      { exactTotal: paise(590_00n) }
    )
    expect(totals).toMatchObject({
      taxable: 500_00n,
      cgst: 45_00n,
      sgst: 45_00n,
      roundOff: 0n,
      total: 590_00n,
    })
  })

  it("an awkward refund still lands exactly through Round-off", () => {
    const plan = planRefundCredit(
      [line("l1", 1_000_00n)],
      paise(333_33n),
      supply
    )
    if (!plan.ok) throw new Error(plan.reason)
    const planned = planCreditLines([line("l1", 1_000_00n)], plan.requests)
    const { totals } = computeDocument(
      planned.map((l) => ({
        quantityMilli: l.quantityMilli,
        unitPrice: l.unitPrice,
        rateBps: l.gstRateBps,
      })),
      supply,
      { exactTotal: paise(333_33n) }
    )
    expect(totals.total).toBe(333_33n)
    expect(totals.taxable + totals.cgst + totals.sgst + totals.roundOff).toBe(
      333_33n
    )
  })

  it("no GST charged: the refund is all taxable value", () => {
    const plan = planRefundCredit([line("l1", 1_000_00n)], paise(400_00n), {
      intrastate: false,
      chargesGst: false,
    })
    expect(plan).toEqual({
      ok: true,
      requests: [{ invoiceLineId: "l1", taxable: 400_00n }],
    })
  })

  it("won't guess across GST rates, over-refunds or a fully credited invoice", () => {
    expect(
      planRefundCredit(
        [line("l1", 1_000_00n), line("l2", 500_00n, 500)],
        paise(100_00n),
        supply
      )
    ).toEqual({
      ok: false,
      reason:
        "The invoice has lines at different GST rates: choose which lines the refund is for.",
    })
    expect(
      planRefundCredit([line("l1", 1_000_00n)], paise(1_181_00n), supply)
    ).toMatchObject({ ok: false })
    expect(
      planRefundCredit(
        [line("l1", 1_000_00n, 1800, 1_000_00n)],
        paise(1_00n),
        supply
      )
    ).toEqual({
      ok: false,
      reason: "The invoice has already been fully credited.",
    })
  })
})
