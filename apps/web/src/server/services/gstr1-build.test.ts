import { gstr1PayloadSchema } from "@workspace/contracts"
import { paise } from "@workspace/ledger"
import { describe, expect, it } from "vitest"

import {
  B2CL_THRESHOLD_PAISE,
  buildGstr1,
  rupeesOf,
  supplyRows,
} from "./gstr1-build"
import type { CreditNoteDoc, DocLine, InvoiceDoc } from "./gstr1-build"

const line = (
  taxable: bigint,
  rateBps: number,
  intra: boolean,
  hsnSac = "998314"
): DocLine => {
  const tax = (taxable * BigInt(rateBps)) / 10000n
  const half = tax / 2n
  return {
    hsnSac,
    description: "Software services",
    quantityMilli: 1000n,
    rateBps,
    taxable: paise(taxable),
    cgst: paise(intra ? tax - half : 0n),
    sgst: paise(intra ? half : 0n),
    igst: paise(intra ? 0n : tax),
  }
}
const total = (lines: DocLine[]) =>
  paise(lines.reduce((s, l) => s + l.taxable + l.cgst + l.sgst + l.igst, 0n))

const inv = (
  number: string,
  over: Partial<InvoiceDoc> & { lines: DocLine[] }
): InvoiceDoc => ({
  number,
  date: "2026-11-05",
  partyGstin: null,
  placeOfSupply: "29",
  supplyType: "intrastate",
  reverseCharge: false,
  cancelled: false,
  total: total(over.lines),
  ...over,
})

const ORG = { gstin: "29ABCDE1234F1Z5", orgStateCode: "29", period: "2026-11" }

describe("rupeesOf", () => {
  it("converts paise exactly", () => {
    expect(rupeesOf(12345678_05n)).toBe(12345678.05)
    expect(rupeesOf(-150n)).toBe(-1.5)
    expect(rupeesOf(0n)).toBe(0)
  })
})

describe("buildGstr1", () => {
  const b2b = inv("INV/2026-27/0001", {
    partyGstin: "29AAPFU0939F1ZV",
    lines: [line(1_00_000_00n, 1800, true), line(10_000_00n, 500, true)],
  })
  const b2clInv = inv("INV/2026-27/0002", {
    placeOfSupply: "27",
    supplyType: "interstate",
    lines: [line(1_00_000_00n, 1800, false)],
  })
  const b2csInter = inv("INV/2026-27/0003", {
    placeOfSupply: "27",
    supplyType: "interstate",
    lines: [line(10_000_00n, 1800, false)],
  })
  const b2csIntra = inv("INV/2026-27/0004", {
    lines: [line(5_000_00n, 1800, true)],
  })
  const lut = inv("INV/2026-27/0005", {
    placeOfSupply: "96",
    supplyType: "export_lut",
    lines: [{ ...line(2_00_000_00n, 1800, false), igst: paise(0n) }],
  })
  const sez = inv("INV/2026-27/0006", {
    partyGstin: "27AAPFU0939F1ZV",
    placeOfSupply: "27",
    supplyType: "sez",
    lines: [line(50_000_00n, 1800, false)],
  })
  const cancelled = inv("INV/2026-27/0007", {
    cancelled: true,
    lines: [line(1_000_00n, 1800, true)],
  })
  const cnB2b: CreditNoteDoc = {
    number: "CN/2026-27/0001",
    date: "2026-11-20",
    partyGstin: b2b.partyGstin,
    placeOfSupply: "29",
    supplyType: "intrastate",
    reverseCharge: false,
    total: total([line(10_000_00n, 1800, true)]),
    invoice: { total: b2b.total },
    lines: [line(10_000_00n, 1800, true)],
  }
  const cnB2cs: CreditNoteDoc = {
    ...cnB2b,
    number: "CN/2026-27/0002",
    partyGstin: null,
    total: total([line(1_000_00n, 1800, true)]),
    invoice: { total: b2csIntra.total },
    lines: [line(1_000_00n, 1800, true)],
  }

  const { payload, warnings } = buildGstr1({
    ...ORG,
    invoices: [b2b, b2clInv, b2csInter, b2csIntra, lut, sez, cancelled],
    creditNotes: [cnB2b, cnB2cs],
    noInvoiceSales: [
      {
        rateBps: 1800,
        taxable: paise(2_000_00n),
        cgst: paise(180_00n),
        sgst: paise(180_00n),
        igst: paise(0n),
      },
    ],
  })

  it("matches the offline tool schema", () => {
    expect(gstr1PayloadSchema.safeParse(payload).success).toBe(true)
    expect(payload.fp).toBe("112026")
  })

  it("puts registered customers and SEZ in B2B, one item per rate", () => {
    expect(payload.b2b.map((c) => c.ctin)).toEqual([
      "29AAPFU0939F1ZV",
      "27AAPFU0939F1ZV",
    ])
    const first = payload.b2b[0]?.inv[0]
    expect(first).toMatchObject({
      inum: "INV/2026-27/0001",
      idt: "05-11-2026",
      pos: "29",
      rchrg: "N",
      inv_typ: "R",
    })
    expect(first?.itms.map((i) => i.itm_det)).toEqual([
      { txval: 10000, rt: 5, camt: 250, samt: 250, csamt: 0 },
      { txval: 100000, rt: 18, camt: 9000, samt: 9000, csamt: 0 },
    ])
    expect(payload.b2b[1]?.inv[0]).toMatchObject({ inv_typ: "SEWP" })
    expect(payload.b2b[1]?.inv[0]?.itms[0]?.itm_det.iamt).toBe(9000)
  })

  it("splits B2C interstate at the B2CL threshold", () => {
    expect(b2clInv.total > B2CL_THRESHOLD_PAISE).toBe(true)
    expect(payload.b2cl).toEqual([
      {
        pos: "27",
        inv: [
          expect.objectContaining({ inum: "INV/2026-27/0002", val: 118000 }),
        ],
      },
    ])
    expect(payload.b2cs).toContainEqual({
      sply_ty: "INTER",
      pos: "27",
      typ: "OE",
      txval: 10000,
      rt: 18,
      iamt: 1800,
      csamt: 0,
    })
  })

  it("nets B2C credit notes and adds no-invoice sales into B2CS", () => {
    // 5,000 sale − 1,000 credit note + 2,000 without invoice.
    expect(payload.b2cs).toContainEqual({
      sply_ty: "INTRA",
      pos: "29",
      typ: "OE",
      txval: 6000,
      rt: 18,
      camt: 540,
      samt: 540,
      csamt: 0,
    })
    expect(warnings.some((w) => w.includes("without an invoice"))).toBe(true)
  })

  it("reports exports and B2B credit notes in their own sections", () => {
    expect(payload.exp).toEqual([
      {
        exp_typ: "WOPAY",
        inv: [
          expect.objectContaining({
            inum: "INV/2026-27/0005",
            itms: [{ txval: 200000, rt: 18, iamt: 0, csamt: 0 }],
          }),
        ],
      },
    ])
    expect(warnings.some((w) => w.includes("shipping bill"))).toBe(true)
    expect(payload.cdnr).toEqual([
      {
        ctin: "29AAPFU0939F1ZV",
        nt: [
          expect.objectContaining({
            ntty: "C",
            nt_num: "CN/2026-27/0001",
            nt_dt: "20-11-2026",
            val: 11800,
          }),
        ],
      },
    ])
  })

  it("leaves cancelled invoices out and counts them in doc_issue", () => {
    const all = JSON.stringify(payload)
    expect(all).not.toContain('"inum":"INV/2026-27/0007"')
    expect(payload.doc_issue.doc_det).toEqual([
      {
        doc_num: 1,
        docs: [
          {
            num: 1,
            from: "INV/2026-27/0001",
            to: "INV/2026-27/0007",
            totnum: 7,
            cancel: 1,
            net_issue: 6,
          },
        ],
      },
      {
        doc_num: 5,
        docs: [
          {
            num: 1,
            from: "CN/2026-27/0001",
            to: "CN/2026-27/0002",
            totnum: 2,
            cancel: 0,
            net_issue: 2,
          },
        ],
      },
    ])
  })

  it("summarises HSN net of credit notes and flags bad codes", () => {
    const row = payload.hsn.data.find(
      (d) => d.hsn_sc === "998314" && d.rt === 18
    )
    // Invoices 1,00,000 + 1,00,000 + 10,000 + 5,000 + 2,00,000 + 50,000,
    // minus credit notes 10,000 + 1,000.
    expect(row?.txval).toBe(454000)
    expect(row?.uqc).toBe("NA")
    const bad = buildGstr1({
      ...ORG,
      invoices: [
        inv("INV/2026-27/0100", { lines: [line(100n, 1800, true, "99")] }),
      ],
      creditNotes: [],
      noInvoiceSales: [],
    })
    expect(bad.payload.hsn.data).toEqual([])
    expect(bad.warnings[0]).toContain('HSN/SAC "99"')
  })
})

describe("supplyRows", () => {
  it("groups by category and rate", () => {
    const rows = supplyRows(
      [
        inv("A", { lines: [line(100_00n, 1800, true)] }),
        inv("B", {
          reverseCharge: true,
          lines: [
            { ...line(50_00n, 1800, true), cgst: paise(0n), sgst: paise(0n) },
          ],
        }),
        inv("C", {
          supplyType: "export_lut",
          lines: [{ ...line(70_00n, 0, false) }],
        }),
      ],
      [
        {
          rateBps: 1800,
          taxable: paise(10_00n),
          cgst: paise(90n),
          sgst: paise(90n),
          igst: paise(0n),
        },
      ]
    )
    expect(
      rows.map((r) => [r.category, r.rateBps, r.taxable, r.documentCount])
    ).toEqual([
      ["taxable", 1800, 100_00n, 1],
      ["reverse_charge", 1800, 50_00n, 1],
      ["export_lut", 0, 70_00n, 1],
      ["no_invoice", 1800, 10_00n, 0],
    ])
  })
})
