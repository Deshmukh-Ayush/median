import "server-only"

import path from "node:path"

import type * as ReactPdfModule from "@react-pdf/renderer"

import { gstStateByCode } from "@workspace/contracts"
import { formatMoney } from "@workspace/ui/lib/format-money"

import { amountInWords } from "@/lib/amount-in-words"
import { formatDate } from "@/lib/format-date"
import { supplyLabel } from "@/lib/invoices"
import type { Invoice } from "@/server/services"

/** @react-pdf/renderer, loaded with import() so it stays server-only. */
type ReactPdf = typeof ReactPdfModule

/**
 * Noto Sans (SIL OFL, fonts/OFL.txt), because the built-in Helvetica has no
 * ₹ glyph. react-pdf embeds only the glyphs used. next.config.ts traces the
 * fonts folder into the invoice routes so the files exist on Vercel.
 */
const FONT = "Noto Sans"
let fontsRegistered = false
function registerFonts(pdf: ReactPdf): void {
  if (fontsRegistered) return
  const dir = path.join(process.cwd(), "src/server/pdf/fonts")
  pdf.Font.register({
    family: FONT,
    fonts: [
      { src: path.join(dir, "NotoSans-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "NotoSans-Bold.ttf"), fontWeight: 700 },
    ],
  })
  // Long descriptions and GSTINs mustn't be split with hyphens.
  pdf.Font.registerHyphenationCallback((word) => [word])
  fontsRegistered = true
}

export interface InvoiceSupplier {
  readonly name: string
  readonly gstin: string | null
  readonly stateCode: string | null
}

/** Bare amount for table cells; the ₹ is in the column heading. */
const rs = (value: Invoice["total"]) => formatMoney(value, { symbol: false })
/** Amount with the ₹ sign, for the totals. */
const inr = (value: Invoice["total"]) => formatMoney(value)

/** The supply line printed beside the place of supply (shared with the app). */
export { supplyLabel }

/**
 * The endorsement rule 46 requires on export and SEZ invoices, or null for
 * domestic supplies. SEZ supplies are taxed with IGST (see resolveSupply).
 */
export function exportEndorsement(
  supplyType: Invoice["supplyType"]
): string | null {
  const prefix =
    "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS"
  switch (supplyType) {
    case "export_with_payment":
    case "sez":
      return `${prefix} ON PAYMENT OF INTEGRATED TAX`
    case "export_lut":
      return `${prefix} UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX`
    case "intrastate":
    case "interstate":
      return null
  }
}

function stateLabel(code: string | null): string {
  if (!code) return "—"
  const state = gstStateByCode(code)
  return state ? `${state.name} (${code})` : code
}

/**
 * A GST tax invoice (CGST Rules, rule 46): supplier and recipient GSTIN,
 * number and date, place of supply with state, HSN/SAC, quantity, taxable
 * value, rate and tax per line, totals, amount in words and signatory.
 * Every amount is printed as the backend computed it; nothing is added up
 * here. Addresses aren't in the contract yet. A plain function, not a
 * component: renderToBuffer needs the <Document> element itself.
 */
export function invoiceDocument({
  pdf,
  invoice,
  supplier,
}: {
  pdf: ReactPdf
  invoice: Invoice
  supplier: InvoiceSupplier
}) {
  registerFonts(pdf)
  const { Document, Page, StyleSheet, Text, View } = pdf
  const intra = invoice.supplyType === "intrastate"
  const endorsement = exportEndorsement(invoice.supplyType)
  const s = StyleSheet.create({
    page: { padding: 36, fontSize: 9, fontFamily: FONT, color: "#111" },
    bold: { fontWeight: 700 },
    muted: { color: "#555" },
    title: { fontSize: 14, fontWeight: 700, marginBottom: 2 },
    row: { flexDirection: "row" },
    box: { border: "1 solid #999", padding: 8 },
    half: { flex: 1 },
    th: {
      fontWeight: 700,
      fontSize: 7.5,
      backgroundColor: "#eee",
      paddingVertical: 4,
      paddingHorizontal: 2,
    },
    // Amounts never wrap (see registerFonts), so the columns are sized for
    // ₹99,99,99,999.99 at this size.
    td: { fontSize: 7.5, paddingVertical: 4, paddingHorizontal: 2 },
    right: { textAlign: "right" },
  })

  // Widths add up to 100%.
  const columns = [
    { title: "#", width: "3%" },
    { title: "Description", width: intra ? "17%" : "29%" },
    { title: "HSN/SAC", width: "8%" },
    { title: "Qty", width: "5%", right: true },
    { title: "Rate (₹)", width: "12%", right: true },
    { title: "Taxable (₹)", width: "12%", right: true },
    { title: "GST", width: "5%", right: true },
    ...(intra
      ? [
          { title: "CGST (₹)", width: "12%", right: true },
          { title: "SGST (₹)", width: "12%", right: true },
        ]
      : [{ title: "IGST (₹)", width: "12%", right: true }]),
    { title: "Total (₹)", width: "14%", right: true },
  ]
  const cell = (i: number, text: string, header = false) => {
    const col = columns[i]
    return (
      <Text
        key={i}
        style={[
          header ? s.th : s.td,
          { width: col?.width ?? "10%" },
          ...(col?.right ? [s.right] : []),
        ]}
      >
        {text}
      </Text>
    )
  }

  const totals: [string, Invoice["total"]][] = [
    ["Taxable value", invoice.taxable],
    ...(intra
      ? ([
          ["CGST", invoice.cgst],
          ["SGST", invoice.sgst],
        ] as [string, Invoice["total"]][])
      : ([["IGST", invoice.igst]] as [string, Invoice["total"]][])),
    ...(invoice.roundOff === 0n
      ? []
      : ([["Round-off", invoice.roundOff]] as [string, Invoice["total"]][])),
  ]

  return (
    <Document title={`Invoice ${invoice.number}`} author={supplier.name}>
      <Page size="A4" style={s.page}>
        <View style={[s.row, { marginBottom: 12 }]}>
          <View style={s.half}>
            <Text style={s.title}>{supplier.name}</Text>
            <Text>GSTIN: {supplier.gstin ?? "Not registered"}</Text>
            <Text>State: {stateLabel(supplier.stateCode)}</Text>
          </View>
          <View style={[s.half, { alignItems: "flex-end" }]}>
            <Text style={s.title}>TAX INVOICE</Text>
            <Text>
              <Text style={s.bold}>Invoice no: </Text>
              {invoice.number}
            </Text>
            <Text>
              <Text style={s.bold}>Date: </Text>
              {formatDate(invoice.invoiceDate)}
            </Text>
            <Text>
              <Text style={s.bold}>Due: </Text>
              {formatDate(invoice.dueDate)}
            </Text>
          </View>
        </View>

        <View style={[s.row, { marginBottom: 12, gap: 8 }]}>
          <View style={[s.box, s.half]}>
            <Text style={[s.bold, { marginBottom: 2 }]}>Bill to</Text>
            <Text>{invoice.party.name}</Text>
            {invoice.party.address ? (
              <Text>{invoice.party.address}</Text>
            ) : null}
            <Text>GSTIN: {invoice.party.gstin ?? "Unregistered"}</Text>
          </View>
          <View style={[s.box, s.half]}>
            <Text>
              <Text style={s.bold}>Place of supply: </Text>
              {stateLabel(invoice.placeOfSupply)}
            </Text>
            <Text>
              <Text style={s.bold}>Supply: </Text>
              {supplyLabel(invoice.supplyType)}
            </Text>
            <Text>
              <Text style={s.bold}>Tax payable on reverse charge: </Text>
              {invoice.reverseCharge ? "Yes" : "No"}
            </Text>
            {invoice.reverseCharge ? (
              <Text style={s.muted}>
                GST on this supply is payable by the recipient.
              </Text>
            ) : null}
          </View>
        </View>

        {endorsement ? (
          <Text style={[s.bold, { marginBottom: 8 }]}>{endorsement}</Text>
        ) : null}

        <View style={[s.row, { borderBottom: "1 solid #999" }]}>
          {columns.map((c, i) => cell(i, c.title, true))}
        </View>
        {invoice.lines.map((line, index) => (
          <View
            key={line.id}
            style={[s.row, { borderBottom: "0.5 solid #ccc" }]}
            wrap={false}
          >
            {[
              String(index + 1),
              line.description,
              line.hsnSac,
              line.quantity,
              rs(line.unitPrice),
              rs(line.taxable),
              `${line.gstRateBps / 100}%`,
              ...(intra ? [rs(line.cgst), rs(line.sgst)] : [rs(line.igst)]),
              rs(line.total),
            ].map((text, i) => cell(i, text))}
          </View>
        ))}

        <View style={[s.row, { marginTop: 8 }]}>
          <View style={[s.half, { paddingRight: 12 }]}>
            <Text style={s.bold}>Amount in words</Text>
            <Text>{amountInWords(invoice.total)}</Text>
            {invoice.notes ? (
              <Text style={[s.muted, { marginTop: 8 }]}>{invoice.notes}</Text>
            ) : null}
          </View>
          <View style={{ width: 200 }}>
            {totals.map(([label, value]) => (
              <View key={label} style={[s.row, { paddingVertical: 2 }]}>
                <Text style={{ flex: 1 }}>{label}</Text>
                <Text style={s.right}>{inr(value)}</Text>
              </View>
            ))}
            <View
              style={[
                s.row,
                { borderTop: "1 solid #111", paddingVertical: 3, marginTop: 2 },
              ]}
            >
              <Text style={[s.bold, { flex: 1 }]}>Total</Text>
              <Text style={[s.bold, s.right]}>{inr(invoice.total)}</Text>
            </View>
          </View>
        </View>

        <View style={{ marginTop: 36, alignItems: "flex-end" }}>
          <Text>For {supplier.name}</Text>
          <Text style={[s.muted, { marginTop: 28 }]}>Authorised signatory</Text>
        </View>
      </Page>
    </Document>
  )
}
