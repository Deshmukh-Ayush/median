import { ServiceError } from "@workspace/contracts"
import type { BillExtraction } from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import { buildBillProposal, printedRateBps } from "./bill-proposal"
import type { BillContext } from "./bill-proposal"

const bill: BillExtraction = {
  vendor: {
    name: "Amazon Web Services",
    gstin: "29AAICA3918J1ZE",
    stateCode: "29",
  },
  billNumber: "IN-2026-1",
  billDate: "2026-11-01",
  dueDate: null,
  placeOfSupplyStateCode: "29",
  currency: "INR",
  lines: [
    {
      description: "EC2",
      hsnSac: "998315",
      quantity: "1",
      taxableAmount: "1,000.00",
      gstRatePercent: "18",
    },
    {
      description: "Support",
      hsnSac: null,
      quantity: null,
      taxableAmount: "0.25",
      gstRatePercent: "18%",
    },
  ],
  printedTotals: {
    taxable: null,
    cgst: null,
    sgst: null,
    igst: null,
    total: null,
  },
}
const ctx: BillContext = {
  org: { stateCode: "29", claimsItc: true },
  accounts: {
    expense: "hosting",
    expenseKnown: true,
    payables: "ap",
    inputCgst: "icgst",
    inputSgst: "isgst",
    inputIgst: "iigst",
    roundOff: "ro",
  },
  vendor: { partyId: "aws", isNew: false },
  masterRates: new Map(),
  duplicate: false,
}

function summary(p: ReturnType<typeof buildBillProposal>) {
  const debit = p.entry.lines.reduce((s, l) => s + l.debit, 0n)
  expect(p.entry.lines.reduce((s, l) => s + l.credit, 0n)).toBe(debit)
  return Object.fromEntries(
    p.entry.lines.map((l) => [
      `${l.debit > 0n ? "Dr" : "Cr"} ${l.accountId}`,
      l.debit > 0n ? l.debit : l.credit,
    ])
  )
}
const fields = (p: ReturnType<typeof buildBillProposal>) =>
  p.flags.map((f) => f.field)

describe("buildBillProposal", () => {
  it("recomputes tax per line in code, odd paisa on CGST", () => {
    const p = buildBillProposal(bill, [], ctx)
    // 18% of 1000.00 = 180.00; of 0.25 = 4.5 → 5 paise (half up): CGST 3, SGST 2.
    expect(p.gst).toEqual({
      taxable: 1_000_25n,
      cgst: 90_03n,
      sgst: 90_02n,
      igst: 0n,
      rateBps: 1800,
      supplyType: "intrastate",
    })
    expect(summary(p)).toEqual({
      "Dr hosting": 1_000_25n,
      "Dr icgst": 90_03n,
      "Dr isgst": 90_02n,
      "Cr ap": 1_180_30n,
    })
    expect(p.entry.lines.at(-1)).toMatchObject({
      partyId: "aws",
      description: "Bill IN-2026-1",
    })
    expect(p.entry).toMatchObject({
      entryDate: "2026-11-01",
      narration: "Amazon Web Services bill IN-2026-1",
    })
    expect(p.flags).toEqual([])
    expect(p.confidence).toBe(0.8)
  })

  it("IGST when the vendor is in another state", () => {
    const p = buildBillProposal(
      { ...bill, vendor: { ...bill.vendor, gstin: "27AAICA3918J1ZA" } },
      [],
      ctx
    )
    expect(p.gst).toMatchObject({
      igst: 180_05n,
      cgst: 0n,
      supplyType: "interstate",
    })
  })

  it("follows a rupee-rounded printed total through Round-off, and flags other totals", () => {
    const rounded = buildBillProposal(
      { ...bill, printedTotals: { ...bill.printedTotals, total: "1,180.00" } },
      [],
      ctx
    )
    expect(summary(rounded)).toMatchObject({ "Cr ro": 30n, "Cr ap": 1_180_00n })
    const exact = buildBillProposal(
      { ...bill, printedTotals: { ...bill.printedTotals, total: "1180.30" } },
      [],
      ctx
    )
    expect(summary(exact)["Cr ap"]).toBe(1_180_30n)
    const wrong = buildBillProposal(
      { ...bill, printedTotals: { ...bill.printedTotals, total: "1,280.30" } },
      [],
      ctx
    )
    expect(fields(wrong)).toContain("printedTotals.total")
    expect(summary(wrong)["Cr ap"]).toBe(1_180_30n)
  })

  it("cross-checks printed tax but never uses it", () => {
    const p = buildBillProposal(
      {
        ...bill,
        printedTotals: { ...bill.printedTotals, cgst: "100.00", sgst: "90.02" },
      },
      [],
      ctx
    )
    expect(fields(p)).toEqual(["printedTotals.cgst"])
    expect(p.gst.cgst).toBe(90_03n)
  })

  it("takes a missing rate from the HSN/SAC master, else flags it at 0%", () => {
    const noRate = {
      ...bill,
      lines: [{ ...bill.lines[0]!, gstRatePercent: null }],
    }
    const master = buildBillProposal(noRate, [], {
      ...ctx,
      masterRates: new Map([[0, 1800]]),
    })
    expect(master.gst.cgst + master.gst.sgst).toBe(180_00n)
    expect(master.flags[0]).toMatchObject({
      field: "lines[0].gstRatePercent",
      reason: expect.any(String) as string,
    })
    const none = buildBillProposal(noRate, [], ctx)
    expect(none.gst.cgst).toBe(0n)
    expect(none.flags[0]?.reason).toBe(
      "No GST rate on this line: set it before approving."
    )
    expect(none.confidence).toBeLessThan(0.7)
  })

  it("without input tax credit the GST is part of the cost", () => {
    const p = buildBillProposal(bill, [], {
      ...ctx,
      org: { stateCode: "29", claimsItc: false },
    })
    expect(summary(p)).toEqual({ "Dr hosting": 1_180_30n, "Cr ap": 1_180_30n })
    expect(p.gst).toMatchObject({ cgst: 0n, sgst: 0n, supplyType: null })
    expect(p.flags.map((f) => f.kind)).toEqual(["not_printed"])
  })

  it("low confidence for Suspense, an unknown vendor or a duplicate", () => {
    for (const c of [
      {
        ...ctx,
        accounts: { ...ctx.accounts, expense: "suspense", expenseKnown: false },
      },
      { ...ctx, vendor: { partyId: null, isNew: false } },
      { ...ctx, duplicate: true },
    ]) {
      const p = buildBillProposal(bill, [], c)
      expect(p.confidence).toBe(0.5)
      expect(p.flags).toHaveLength(1)
    }
    const fromModel = buildBillProposal(
      bill,
      [
        {
          field: "billDate",
          kind: "needs_review",
          reason: "blurred",
          source: "model",
        },
      ],
      ctx
    )
    expect(fromModel.confidence).toBeLessThan(0.7)
    expect(fromModel.reason).toBe(
      "Bill IN-2026-1 from Amazon Web Services: 1 thing(s) to check."
    )
  })

  it("refuses non-INR bills, bad dates and unreadable amounts", () => {
    expect(() =>
      buildBillProposal({ ...bill, currency: "USD" }, [], ctx)
    ).toThrow(/USD/)
    expect(() =>
      buildBillProposal({ ...bill, billDate: "01/11/2026" }, [], ctx)
    ).toThrow(ServiceError)
    expect(() =>
      buildBillProposal(
        {
          ...bill,
          lines: [{ ...bill.lines[0]!, taxableAmount: "about 1000" }],
        },
        [],
        ctx
      )
    ).toThrow(/lines\[0\]\.taxableAmount/)
  })
})

describe("printedRateBps", () => {
  it.each([
    ["18", 1800],
    ["18%", 1800],
    ["0.25", 25],
    ["12.5 %", 1250],
    ["eighteen", null],
    [null, null],
  ] as const)("%s → %s", (text, bps) => {
    expect(printedRateBps(text)).toBe(bps)
  })
})
