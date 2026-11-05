import sharp from "sharp"

import type { PrintedBill } from "./fixtures"

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

interface Cell {
  x: number
  text: string
  anchor?: "start" | "middle" | "end" | undefined
  bold?: boolean
  size?: number
}

function svgRow(y: number, cells: Cell[]): string {
  return cells
    .map(
      (c) =>
        `<text x="${c.x}" y="${y}" text-anchor="${c.anchor ?? "start"}" font-size="${c.size ?? 15}"${c.bold ? ' font-weight="bold"' : ""}>${escape(c.text)}</text>`
    )
    .join("")
}

/** A printed-and-scanned style classic invoice. */
function classicSvg(b: PrintedBill): {
  svg: string
  width: number
  height: number
} {
  const width = 1100
  const intra = b.supply === "intra"
  let y = 50
  const out: string[] = []
  const line = (cells: Cell[], step = 24) => {
    out.push(svgRow(y, cells))
    y += step
  }
  line(
    [
      {
        x: width / 2,
        text: "TAX INVOICE",
        anchor: "middle",
        bold: true,
        size: 24,
      },
    ],
    40
  )
  line(
    [
      { x: 40, text: b.vendorName, bold: true, size: 20 },
      { x: 680, text: `Invoice No: ${b.billNumber}` },
    ],
    24
  )
  line([
    { x: 40, text: b.vendorAddress },
    { x: 680, text: `Date: ${b.billDateText}` },
  ])
  line([
    { x: 40, text: `GSTIN: ${b.vendorGstin}` },
    { x: 680, text: b.dueDateText ? `Due: ${b.dueDateText}` : "" },
  ])
  line([{ x: 680, text: `Place of Supply: ${b.placeOfSupplyText}` }], 34)
  line([{ x: 40, text: `Bill To: ${b.buyerName}`, bold: true }])
  line([{ x: 40, text: `${b.buyerAddress}  GSTIN: ${b.buyerGstin}` }], 36)

  const head = intra
    ? [
        "Description",
        "HSN/SAC",
        "Qty",
        "Rate",
        "Taxable",
        "GST%",
        "CGST",
        "SGST",
      ]
    : ["Description", "HSN/SAC", "Qty", "Rate", "Taxable", "GST%", "IGST", ""]
  const xs = [40, 450, 580, 680, 800, 860, 965, 1065]
  const anchors: ("start" | "end")[] = [
    "start",
    "start",
    "end",
    "end",
    "end",
    "end",
    "end",
    "end",
  ]
  out.push(
    `<line x1="30" y1="${y - 18}" x2="${width - 30}" y2="${y - 18}" stroke="#000"/>`
  )
  line(
    head.map((t, i) => ({
      x: xs[i] ?? 0,
      text: t,
      anchor: anchors[i],
      bold: true,
    })),
    10
  )
  out.push(
    `<line x1="30" y1="${y - 4}" x2="${width - 30}" y2="${y - 4}" stroke="#000"/>`
  )
  y += 16
  for (const l of b.lines) {
    const desc = l.description
    const values = [
      desc,
      l.hsnSac ?? "",
      l.quantity ?? "",
      l.rate ?? "",
      l.taxableAmount,
      `${l.gstRate}%`,
      intra ? (l.cgst ?? "") : (l.igst ?? ""),
      intra ? (l.sgst ?? "") : "",
    ]
    line(
      values.map((t, i) => ({ x: xs[i] ?? 0, text: t, anchor: anchors[i] })),
      26
    )
  }
  out.push(
    `<line x1="30" y1="${y - 12}" x2="${width - 30}" y2="${y - 12}" stroke="#000"/>`
  )
  y += 10
  const totals: [string, string | null][] = [
    ["Taxable Value", b.totals.taxable],
    ["CGST", b.totals.cgst],
    ["SGST", b.totals.sgst],
    ["IGST", b.totals.igst],
    ["Round off", b.totals.roundOff],
    ["Invoice Total (Rs.)", b.totals.total],
  ]
  for (const [label, value] of totals) {
    if (value === null) continue
    const bold = label.startsWith("Invoice Total")
    line([
      { x: 760, text: label, bold },
      { x: 1065, text: value, anchor: "end", bold },
    ])
  }
  y += 10
  line([{ x: 40, text: b.totalInWords, size: 13 }], 30)
  return { svg: wrap(out.join(""), width, y), width, height: y }
}

/** A narrow thermal-receipt style bill. */
function receiptSvg(b: PrintedBill): {
  svg: string
  width: number
  height: number
} {
  const width = 560
  let y = 40
  const out: string[] = []
  const line = (cells: Cell[], step = 22) => {
    out.push(svgRow(y, cells))
    y += step
  }
  const dash = () => line([{ x: 20, text: "-".repeat(62), size: 13 }], 20)
  line(
    [
      {
        x: width / 2,
        text: b.vendorName,
        anchor: "middle",
        bold: true,
        size: 18,
      },
    ],
    24
  )
  line([{ x: 20, text: b.vendorAddress, size: 13 }])
  line([{ x: 20, text: `GSTIN ${b.vendorGstin}`, size: 14 }])
  line([{ x: 20, text: "TAX INVOICE", bold: true }])
  line([
    { x: 20, text: `Bill: ${b.billNumber}` },
    { x: 540, text: b.billDateText, anchor: "end" },
  ])
  line([{ x: 20, text: `POS: ${b.placeOfSupplyText}` }])
  if (b.dueDateText) line([{ x: 20, text: `Due: ${b.dueDateText}` }])
  line([{ x: 20, text: `To: ${b.buyerName}`, size: 13 }])
  line([{ x: 20, text: `GSTIN ${b.buyerGstin}`, size: 13 }])
  dash()
  for (const l of b.lines) {
    const desc = l.description
    line([{ x: 20, text: desc }], 20)
    line(
      [
        { x: 30, text: `HSN ${l.hsnSac ?? "-"}`, size: 13 },
        { x: 200, text: `${l.quantity ?? ""} x ${l.rate ?? ""}`, size: 13 },
        { x: 400, text: `GST ${l.gstRate}%`, size: 13 },
        { x: 540, text: l.taxableAmount, anchor: "end" },
      ],
      24
    )
  }
  dash()
  const totals: [string, string | null][] = [
    ["CGST", b.totals.cgst],
    ["SGST", b.totals.sgst],
    ["IGST", b.totals.igst],
    ["Round off", b.totals.roundOff],
    ["NET PAYABLE", b.totals.total],
  ]
  for (const [label, value] of totals) {
    if (value === null) continue
    const bold = label === "NET PAYABLE"
    line([
      { x: 20, text: label, bold },
      { x: 540, text: value, anchor: "end", bold },
    ])
  }
  dash()
  line(
    [
      {
        x: 20,
        text: "Thank you. Goods once sold will not be taken back.",
        size: 12,
      },
    ],
    30
  )
  return { svg: wrap(out.join(""), width, y), width, height: y }
}

function wrap(body: string, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/><g font-family="Arial, Helvetica, sans-serif" fill="#111">${body}</g></svg>`
}

export async function renderImage(
  bill: PrintedBill,
  seed: number
): Promise<{ data: Buffer; mediaType: "image/png" | "image/jpeg" }> {
  const { svg, width, height } =
    bill.layout === "receipt" ? receiptSvg(bill) : classicSvg(bill)
  const image = sharp(Buffer.from(svg))
  if (bill.quality === "image-clean") {
    return { data: await image.png().toBuffer(), mediaType: "image/png" }
  }
  // Poor scan: slight skew, grey paper, blur, downsample, heavy JPEG.
  const angle = ((seed % 5) - 2) * 0.6 || 0.8
  const scale = bill.layout === "receipt" ? 0.75 : 0.62
  const degraded = await image
    .rotate(angle, { background: "#ebe7df" })
    .flatten({ background: "#ebe7df" })
    .grayscale()
    .blur(0.9)
    .resize({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      fit: "inside",
    })
    .linear(0.85, 22)
    .jpeg({ quality: 32 })
    .toBuffer()
  return { data: degraded, mediaType: "image/jpeg" }
}
