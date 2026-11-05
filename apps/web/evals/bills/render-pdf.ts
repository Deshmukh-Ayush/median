import {
  Document,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer"
import { createElement as h, type ReactElement, type ReactNode } from "react"

import type { PrintedBill, PrintedLine } from "./fixtures"

type Style = Record<string, string | number>

const base = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  bold: { fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row" },
  small: { fontSize: 8, color: "#444" },
})

const text = (content: ReactNode, style?: Style | Style[]) =>
  h(Text, style ? { style } : {}, content)
const view = (style: Style | Style[], ...children: ReactNode[]) =>
  h(View, { style }, ...children)

interface Column {
  title: string
  width: number
  align?: "left" | "right"
  value: (line: PrintedLine, index: number) => string
}

function table(
  columns: Column[],
  lines: PrintedLine[],
  opts: { header: Style; border: string; zebra?: string }
) {
  const cell = (content: string, col: Column, extra?: Style) =>
    text(content, {
      width: `${col.width}%`,
      padding: 4,
      textAlign: col.align ?? "left",
      ...extra,
    })
  return view(
    { borderWidth: 1, borderColor: opts.border, marginTop: 12 },
    view(
      [base.row, opts.header],
      ...columns.map((c) => cell(c.title, c, { fontFamily: "Helvetica-Bold" }))
    ),
    ...lines.map((line, i) =>
      view(
        [
          base.row,
          {
            borderTopWidth: 1,
            borderColor: opts.border,
            backgroundColor: opts.zebra && i % 2 ? opts.zebra : "#fff",
          },
        ],
        ...columns.map((c) => cell(c.value(line, i), c))
      )
    )
  )
}

function totalsBlock(rows: [string, string | null][], width = 220) {
  return view(
    { alignSelf: "flex-end", width, marginTop: 10 },
    ...rows
      .filter((r): r is [string, string] => r[1] !== null)
      .map(([label, value], i, all) =>
        view(
          [
            base.row,
            { justifyContent: "space-between", paddingVertical: 2 },
            i === all.length - 1
              ? {
                  borderTopWidth: 1,
                  borderColor: "#111",
                  marginTop: 3,
                  paddingTop: 4,
                }
              : {},
          ],
          text(label, i === all.length - 1 ? base.bold : {}),
          text(value, i === all.length - 1 ? base.bold : {})
        )
      )
  )
}

const taxRows = (b: PrintedBill): [string, string | null][] => [
  ["CGST", b.totals.cgst],
  ["SGST", b.totals.sgst],
  ["IGST", b.totals.igst],
  ["Round off", b.totals.roundOff],
]

const hsn = (l: PrintedLine) => l.hsnSac ?? ""

// ---------------------------------------------------------------- layouts

function classic(b: PrintedBill): ReactNode[] {
  const intra = b.supply === "intra"
  const cols: Column[] = [
    { title: "#", width: 4, value: (_l, i) => String(i + 1) },
    {
      title: "Description",
      width: intra ? 26 : 32,
      value: (l) => l.description,
    },
    { title: "HSN/SAC", width: 10, value: hsn },
    { title: "Qty", width: 6, align: "right", value: (l) => l.quantity ?? "" },
    { title: "Rate", width: 11, align: "right", value: (l) => l.rate ?? "" },
    {
      title: "Taxable Value",
      width: 13,
      align: "right",
      value: (l) => l.taxableAmount,
    },
    { title: "GST %", width: 7, align: "right", value: (l) => `${l.gstRate}%` },
    ...(intra
      ? [
          {
            title: "CGST",
            width: 11.5,
            align: "right",
            value: (l: PrintedLine) => l.cgst ?? "",
          } as const,
          {
            title: "SGST",
            width: 11.5,
            align: "right",
            value: (l: PrintedLine) => l.sgst ?? "",
          } as const,
        ]
      : [
          {
            title: "IGST",
            width: 17,
            align: "right",
            value: (l: PrintedLine) => l.igst ?? "",
          } as const,
        ]),
  ]
  return [
    text("TAX INVOICE", [
      base.bold,
      { fontSize: 16, textAlign: "center", marginBottom: 14 },
    ]),
    view(
      [base.row, { justifyContent: "space-between" }],
      view(
        { width: "55%" },
        text(b.vendorName, [base.bold, { fontSize: 12 }]),
        text(b.vendorAddress, base.small),
        text(`GSTIN: ${b.vendorGstin}`, { marginTop: 2 })
      ),
      view(
        { width: "40%" },
        text(`Invoice No: ${b.billNumber}`),
        text(`Invoice Date: ${b.billDateText}`),
        ...(b.dueDateText ? [text(`Due Date: ${b.dueDateText}`)] : []),
        text(`Place of Supply: ${b.placeOfSupplyText}`)
      )
    ),
    view(
      { marginTop: 12, padding: 6, backgroundColor: "#f2f2f2" },
      text("Bill To", base.bold),
      text(b.buyerName),
      text(b.buyerAddress, base.small),
      text(`GSTIN: ${b.buyerGstin}`)
    ),
    table(cols, b.lines, {
      header: { backgroundColor: "#e6e6e6" },
      border: "#999",
    }),
    totalsBlock([
      ["Taxable Value", b.totals.taxable],
      ...taxRows(b),
      ["Invoice Total (Rs.)", b.totals.total],
    ]),
    text(`Amount in words: ${b.totalInWords}`, [base.small, { marginTop: 10 }]),
  ]
}

function summary(b: PrintedBill): ReactNode[] {
  const cols: Column[] = [
    { title: "Sl", width: 5, value: (_l, i) => String(i + 1) },
    { title: "Particulars", width: 39, value: (l) => l.description },
    { title: "HSN", width: 12, value: hsn },
    { title: "GST Rate", width: 9, align: "right", value: (l) => l.gstRate },
    {
      title: "Quantity",
      width: 9,
      align: "right",
      value: (l) => l.quantity ?? "",
    },
    { title: "Rate", width: 12, align: "right", value: (l) => l.rate ?? "" },
    {
      title: "Amount",
      width: 14,
      align: "right",
      value: (l) => l.taxableAmount,
    },
  ]
  return [
    view(
      [
        base.row,
        {
          justifyContent: "space-between",
          borderBottomWidth: 2,
          borderColor: "#1d4e89",
          paddingBottom: 8,
        },
      ],
      view(
        {},
        text(b.vendorName, [base.bold, { fontSize: 14, color: "#1d4e89" }]),
        text(b.vendorAddress, base.small),
        text(`GSTIN/UIN: ${b.vendorGstin}`, base.small)
      ),
      text("Tax Invoice", [base.bold, { fontSize: 12 }])
    ),
    view(
      [base.row, { marginTop: 10 }],
      view(
        { width: "50%" },
        text("Buyer (Bill to)", base.small),
        text(b.buyerName, base.bold),
        text(b.buyerAddress, base.small),
        text(`GSTIN/UIN: ${b.buyerGstin}`, base.small)
      ),
      view(
        { width: "50%", paddingLeft: 10 },
        text(`Invoice No.  ${b.billNumber}`),
        text(`Dated  ${b.billDateText}`),
        ...(b.dueDateText ? [text(`Payment due  ${b.dueDateText}`)] : []),
        text(`Place of supply  ${b.placeOfSupplyText}`)
      )
    ),
    table(cols, b.lines, {
      header: { backgroundColor: "#dce6f2" },
      border: "#1d4e89",
      zebra: "#f5f8fc",
    }),
    totalsBlock(
      [
        ["Total taxable value", b.totals.taxable],
        ...taxRows(b),
        ["Grand Total", b.totals.total],
      ],
      240
    ),
    text("Tax summary by rate", [base.bold, { marginTop: 14 }]),
    view(
      { borderWidth: 1, borderColor: "#999", marginTop: 4, width: 300 },
      view(
        [base.row, { backgroundColor: "#eee" }],
        text("GST Rate", { width: 80, padding: 3 }),
        text("Taxable Value", { width: 110, padding: 3, textAlign: "right" }),
        text("Total Tax", { width: 110, padding: 3, textAlign: "right" })
      ),
      ...b.rateSummary.map((r) =>
        view(
          [base.row, { borderTopWidth: 1, borderColor: "#ccc" }],
          text(`${r.rate}%`, { width: 80, padding: 3 }),
          text(r.taxable, { width: 110, padding: 3, textAlign: "right" }),
          text(r.tax, { width: 110, padding: 3, textAlign: "right" })
        )
      )
    ),
    text(b.totalInWords, [base.small, { marginTop: 10 }]),
  ]
}

function minimal(b: PrintedBill): ReactNode[] {
  const cols: Column[] = [
    { title: "Item", width: 40, value: (l) => l.description },
    { title: "HSN", width: 12, value: hsn },
    { title: "Qty", width: 8, align: "right", value: (l) => l.quantity ?? "" },
    {
      title: "Unit price",
      width: 14,
      align: "right",
      value: (l) => l.rate ?? "",
    },
    { title: "Tax", width: 10, align: "right", value: (l) => `${l.gstRate} %` },
    {
      title: "Amount",
      width: 16,
      align: "right",
      value: (l) => l.taxableAmount,
    },
  ]
  return [
    text(b.vendorName, [base.bold, { fontSize: 20 }]),
    text(`${b.vendorAddress}  ·  GSTIN ${b.vendorGstin}`, [
      base.small,
      { marginBottom: 18 },
    ]),
    view(
      [base.row, { justifyContent: "space-between" }],
      view(
        {},
        text("BILLED TO", base.small),
        text(b.buyerName),
        text(`GSTIN ${b.buyerGstin}`, base.small)
      ),
      view(
        {},
        text("INVOICE", base.small),
        text(b.billNumber, base.bold),
        text(`Issued ${b.billDateText}`, base.small),
        ...(b.dueDateText ? [text(`Due ${b.dueDateText}`, base.small)] : [])
      ),
      view({}, text("PLACE OF SUPPLY", base.small), text(b.placeOfSupplyText))
    ),
    table(cols, b.lines, {
      header: { borderBottomWidth: 1, borderColor: "#000" },
      border: "#ddd",
    }),
    totalsBlock([
      ["Subtotal", b.totals.taxable],
      [
        b.supply === "intra" ? "CGST" : "IGST",
        b.supply === "intra" ? b.totals.cgst : b.totals.igst,
      ],
      ...(b.supply === "intra"
        ? [["SGST", b.totals.sgst] as [string, string | null]]
        : []),
      ["Rounding", b.totals.roundOff],
      ["Total due (INR)", b.totals.total],
    ]),
  ]
}

function service(b: PrintedBill): ReactNode[] {
  const cols: Column[] = [
    { title: "Description of service", width: 56, value: (l) => l.description },
    { title: "SAC", width: 14, value: hsn },
    {
      title: "GST rate",
      width: 12,
      align: "right",
      value: (l) => `${l.gstRate}%`,
    },
    {
      title: "Taxable value (Rs.)",
      width: 18,
      align: "right",
      value: (l) => l.taxableAmount,
    },
  ]
  return [
    view(
      { backgroundColor: "#2f3e46", padding: 12, marginBottom: 12 },
      text(b.vendorName, [base.bold, { fontSize: 14, color: "#fff" }]),
      text(`${b.vendorAddress} | GSTIN: ${b.vendorGstin}`, {
        color: "#dfe7ea",
        fontSize: 8,
      })
    ),
    text("INVOICE FOR SERVICES", [base.bold, { fontSize: 11 }]),
    view(
      [base.row, { marginTop: 8, justifyContent: "space-between" }],
      view(
        { width: "50%" },
        text(`To: ${b.buyerName}`),
        text(b.buyerAddress, base.small),
        text(`Recipient GSTIN: ${b.buyerGstin}`, base.small)
      ),
      view(
        { width: "45%" },
        text(`Invoice #: ${b.billNumber}`),
        text(`Date: ${b.billDateText}`),
        ...(b.dueDateText ? [text(`Pay by: ${b.dueDateText}`)] : []),
        text(`Place of supply: ${b.placeOfSupplyText}`)
      )
    ),
    table(cols, b.lines, {
      header: { backgroundColor: "#cad2c5" },
      border: "#84a98c",
    }),
    totalsBlock(
      [
        ["Taxable value", b.totals.taxable],
        ...taxRows(b),
        ["Total amount payable", b.totals.total],
      ],
      250
    ),
    text(`(${b.totalInWords})`, [base.small, { marginTop: 8 }]),
    text("This is a computer-generated invoice.", [
      base.small,
      { marginTop: 24 },
    ]),
  ]
}

const LAYOUTS = { classic, summary, minimal, service } as const

export async function renderPdf(bill: PrintedBill): Promise<Buffer> {
  if (bill.layout === "receipt") throw new Error("receipt is an image layout")
  const doc: ReactElement = h(
    Document,
    { title: `${bill.vendorName} ${bill.billNumber}` },
    h(Page, { size: "A4", style: base.page }, ...LAYOUTS[bill.layout](bill))
  )
  // renderToBuffer is typed for <Document> elements.
  return renderToBuffer(doc as Parameters<typeof renderToBuffer>[0])
}
