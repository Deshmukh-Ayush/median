/**
 * Synthetic GST invoices for the bill-extraction eval. Every vendor, GSTIN and
 * invoice here is invented. Never add real bills: the eval runs on the Gemini
 * free tier.
 *
 * Each bill is built from a seeded spec into a `PrintedBill`: every string the
 * renderers print. The ground truth is read from the same strings, so the
 * document and its expected extraction can't drift apart. Amounts are integer
 * paise (bigint), formatted with the ledger's `formatInr`.
 */
import { formatInr, paise } from "@workspace/ledger"

import type { AiBillExtraction } from "@/server/ai/bill-extraction"

export type Expected = Omit<AiBillExtraction, "lowConfidenceFields">

export type Layout = "classic" | "summary" | "minimal" | "service" | "receipt"
export type Quality = "pdf" | "image-clean" | "image-low"
export type Supply = "intra" | "inter"

export interface GroundTruth {
  id: string
  file: string
  mediaType: "application/pdf" | "image/png" | "image/jpeg"
  layout: Layout
  quality: Quality
  supply: Supply
  notes: string[]
  expected: Expected
}

/** Everything a renderer prints. Null means "not printed on this layout". */
export interface PrintedLine {
  description: string
  hsnSac: string | null
  quantity: string | null
  rate: string | null
  taxableAmount: string
  gstRate: string
  cgst: string | null
  sgst: string | null
  igst: string | null
}

export interface PrintedBill {
  id: string
  layout: Layout
  quality: Quality
  supply: Supply
  vendorName: string
  vendorAddress: string
  vendorGstin: string
  buyerName: string
  buyerAddress: string
  buyerGstin: string
  billNumber: string
  billDateText: string
  billDateIso: string
  dueDateText: string | null
  dueDateIso: string | null
  placeOfSupplyText: string
  placeOfSupplyCode: string
  lines: PrintedLine[]
  /** GST rate → [taxable, cgst, sgst, igst] for HSN/rate summary tables. */
  rateSummary: { rate: string; taxable: string; tax: string }[]
  totals: {
    taxable: string | null
    cgst: string | null
    sgst: string | null
    igst: string | null
    roundOff: string | null
    total: string
  }
  totalInWords: string
}

// ---------------------------------------------------------------- data

const STATES: Record<string, string> = {
  "06": "Haryana",
  "07": "Delhi",
  "09": "Uttar Pradesh",
  "19": "West Bengal",
  "24": "Gujarat",
  "27": "Maharashtra",
  "29": "Karnataka",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "36": "Telangana",
}

const VENDORS = [
  {
    name: "Lotus Peak Cloud Pvt Ltd",
    state: "29",
    pan: "AAACL4417K",
    city: "HSR Layout, Bengaluru 560102",
  },
  {
    name: "Saffron Lane Office Supplies",
    state: "27",
    pan: "ABHFS2093N",
    city: "Andheri East, Mumbai 400069",
  },
  {
    name: "Brightwater Legal LLP",
    state: "07",
    pan: "AAKFB7781C",
    city: "Saket, New Delhi 110017",
  },
  {
    name: "Kaveri Packaging Works",
    state: "33",
    pan: "AARFK5320D",
    city: "Ambattur, Chennai 600058",
  },
  {
    name: "Neem Tree Digital Media Pvt Ltd",
    state: "24",
    pan: "AAFCN6612H",
    city: "Prahlad Nagar, Ahmedabad 380015",
  },
  {
    name: "Charminar Courier Services",
    state: "36",
    pan: "AAJFC3348P",
    city: "Begumpet, Hyderabad 500016",
  },
  {
    name: "Gomti Furniture House",
    state: "09",
    pan: "ABMFG9021R",
    city: "Gomti Nagar, Lucknow 226010",
  },
  {
    name: "Aravalli Talent Partners Pvt Ltd",
    state: "06",
    pan: "AAGCA1187T",
    city: "Sector 44, Gurugram 122003",
  },
  {
    name: "Hooghly Print & Press",
    state: "19",
    pan: "ABQFH4475M",
    city: "Salt Lake, Kolkata 700091",
  },
  {
    name: "Malabar Coworking Spaces Pvt Ltd",
    state: "32",
    pan: "AAECM8830B",
    city: "Kakkanad, Kochi 682030",
  },
] as const

const BUYER = {
  name: "Median Demo Labs Pvt Ltd",
  pan: "AAJCM4821Q",
  address: "4th Floor, 80 Feet Road, Koramangala, Bengaluru 560034",
  state: "29",
}

interface Item {
  description: string
  hsn: string
  rate: number
  /** Unit price range in whole rupees. */
  price: [number, number]
  service: boolean
}

const ITEMS: Item[] = [
  {
    description: "Cloud hosting - compute instances",
    hsn: "998315",
    rate: 18,
    price: [8000, 60000],
    service: true,
  },
  {
    description: "Software subscription (annual)",
    hsn: "997331",
    rate: 18,
    price: [12000, 90000],
    service: true,
  },
  {
    description: "Laptop stand, aluminium",
    hsn: "84733099",
    rate: 18,
    price: [900, 2600],
    service: false,
  },
  {
    description: "Ergonomic office chair",
    hsn: "94013000",
    rate: 18,
    price: [6500, 14000],
    service: false,
  },
  {
    description: "A4 copier paper, 75 GSM (ream)",
    hsn: "48025690",
    rate: 18,
    price: [240, 420],
    service: false,
  },
  {
    description: "Corrugated shipping boxes",
    hsn: "48191010",
    rate: 5,
    price: [18, 60],
    service: false,
  },
  {
    description: "Courier and delivery services",
    hsn: "996812",
    rate: 18,
    price: [1500, 9000],
    service: true,
  },
  {
    description: "Legal consultation - shareholder agreement",
    hsn: "998211",
    rate: 18,
    price: [25000, 120000],
    service: true,
  },
  {
    description: "Printed brochures",
    hsn: "49011010",
    rate: 5,
    price: [12, 45],
    service: false,
  },
  {
    description: "Performance marketing - campaign management",
    hsn: "998365",
    rate: 18,
    price: [20000, 150000],
    service: true,
  },
  {
    description: "Recruitment services - engineering hire",
    hsn: "998512",
    rate: 18,
    price: [40000, 180000],
    service: true,
  },
  {
    description: "Dedicated desk, monthly",
    hsn: "997212",
    rate: 18,
    price: [7000, 16000],
    service: true,
  },
  {
    description: "Cotton T-shirts, printed (merch)",
    hsn: "61091000",
    rate: 5,
    price: [280, 520],
    service: false,
  },
  {
    description: "USB-C charging cable, 1.5 m",
    hsn: "85444299",
    rate: 18,
    price: [350, 900],
    service: false,
  },
  {
    description: "Pantry snacks assortment",
    hsn: "21069099",
    rate: 5,
    price: [600, 2400],
    service: false,
  },
  {
    description: "Annual maintenance - air conditioners",
    hsn: "998719",
    rate: 18,
    price: [3500, 12000],
    service: true,
  },
]

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

// ---------------------------------------------------------------- helpers

/** Deterministic PRNG (mulberry32) so regenerating gives identical bills. */
function prng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

/** A format-valid GSTIN with a correct check digit (synthetic PAN). */
export function makeGstin(state: string, pan: string, entity = "1"): string {
  const body = `${state}${pan}${entity}Z`
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    const value = GSTIN_CHARS.indexOf(body.charAt(i))
    const product = value * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  const check = GSTIN_CHARS.charAt((36 - (sum % 36)) % 36)
  return body + check
}

/** Integer percentage of an amount in paise, rounded half up. */
function percentOf(amount: bigint, hundredthsOfPercent: bigint): bigint {
  return (amount * hundredthsOfPercent + 5000n) / 10000n
}

const amount = (value: bigint): string =>
  formatInr(paise(value), { symbol: false })

function wordsUnder1000(n: number): string {
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ]
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ]
  const parts: string[] = []
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  if (hundreds) parts.push(`${ones[hundreds] ?? ""} Hundred`)
  if (rest >= 20)
    parts.push(
      `${tens[Math.floor(rest / 10)] ?? ""}${rest % 10 ? ` ${ones[rest % 10] ?? ""}` : ""}`
    )
  else if (rest) parts.push(ones[rest] ?? "")
  return parts.join(" ")
}

/** Rupees in Indian words (crore/lakh/thousand), for the "amount in words" line. */
function rupeesInWords(totalPaise: bigint): string {
  let n = Number(totalPaise / 100n)
  const parts: string[] = []
  for (const [size, name] of [
    [10_000_000, "Crore"],
    [100_000, "Lakh"],
    [1000, "Thousand"],
  ] as const) {
    const count = Math.floor(n / size)
    if (count) parts.push(`${wordsUnder1000(count)} ${name}`)
    n %= size
  }
  if (n) parts.push(wordsUnder1000(n))
  const p = Number(totalPaise % 100n)
  return `Rupees ${parts.join(" ")}${p ? ` and ${wordsUnder1000(p)} Paise` : ""} Only`
}

function formatDate(iso: string, style: number): string {
  const [y, m, d] = iso.split("-")
  const month = MONTHS[Number(m) - 1] ?? ""
  switch (style % 4) {
    case 0:
      return `${d}/${m}/${y}`
    case 1:
      return `${d}-${month.slice(0, 3)}-${y}`
    case 2:
      return `${Number(d)} ${month} ${y}`
    default:
      return `${d}.${m}.${y}`
  }
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------- plan

interface BillPlan {
  layout: Layout
  quality: Quality
  supply: Supply
  missingHsn: boolean
}

/** 30 bills: 24 PDFs in four layouts, 6 images (4 deliberately poor scans). */
const PLAN: BillPlan[] = [
  ...(["classic", "summary", "minimal", "service"] as const).flatMap(
    (layout, l) =>
      Array.from({ length: 6 }, (_, i): BillPlan => ({
        layout,
        quality: "pdf",
        supply: (i + l) % 2 === 0 ? "intra" : "inter",
        missingHsn: layout !== "service" && i === 3,
      }))
  ),
  {
    layout: "classic",
    quality: "image-clean",
    supply: "intra",
    missingHsn: false,
  },
  {
    layout: "classic",
    quality: "image-low",
    supply: "inter",
    missingHsn: false,
  },
  {
    layout: "classic",
    quality: "image-low",
    supply: "intra",
    missingHsn: true,
  },
  {
    layout: "receipt",
    quality: "image-clean",
    supply: "inter",
    missingHsn: false,
  },
  {
    layout: "receipt",
    quality: "image-low",
    supply: "intra",
    missingHsn: false,
  },
  {
    layout: "receipt",
    quality: "image-low",
    supply: "inter",
    missingHsn: false,
  },
]

const PLACE_STYLES = [
  (code: string, name: string) => `${name} (${code})`,
  (code: string, name: string) => `${code}-${name}`,
  (_code: string, name: string) => name,
] as const

/** Which columns each layout prints. */
const PRINTS: Record<
  Layout,
  {
    qtyRate: boolean
    lineTax: boolean
    hsn: boolean
    taxableTotal: boolean
    taxTotals: boolean
  }
> = {
  classic: {
    qtyRate: true,
    lineTax: true,
    hsn: true,
    taxableTotal: true,
    taxTotals: true,
  },
  summary: {
    qtyRate: true,
    lineTax: false,
    hsn: true,
    taxableTotal: true,
    taxTotals: true,
  },
  minimal: {
    qtyRate: true,
    lineTax: false,
    hsn: true,
    taxableTotal: true,
    taxTotals: true,
  },
  service: {
    qtyRate: false,
    lineTax: false,
    hsn: true,
    taxableTotal: true,
    taxTotals: true,
  },
  receipt: {
    qtyRate: true,
    lineTax: false,
    hsn: true,
    taxableTotal: false,
    taxTotals: true,
  },
}

// ---------------------------------------------------------------- build

export function buildBills(seed = 20261106): PrintedBill[] {
  const random = prng(seed)
  const int = (min: number, max: number) =>
    min + Math.floor(random() * (max - min + 1))
  const pick = <T>(list: readonly T[]): T => {
    const value = list[int(0, list.length - 1)]
    if (value === undefined) throw new Error("empty list")
    return value
  }

  return PLAN.map((plan, index) => {
    const id = `bill-${String(index + 1).padStart(2, "0")}`
    const prints = PRINTS[plan.layout]
    // Intra-state: billed to the buyer's branch registration in the vendor's
    // state. Inter-state: billed to the Karnataka head office.
    const vendor =
      plan.supply === "intra"
        ? pick(VENDORS)
        : pick(VENDORS.filter((v) => v.state !== BUYER.state))
    const vendorState = STATES[vendor.state] ?? ""
    const placeCode = plan.supply === "intra" ? vendor.state : BUYER.state
    const placeName = STATES[placeCode] ?? ""
    const buyerAddress =
      placeCode === BUYER.state ? BUYER.address : `Branch office, ${placeName}`

    const lineCount = plan.layout === "service" ? int(1, 2) : int(1, 6)
    const pool = ITEMS.filter((item) =>
      plan.layout === "service" ? item.service : true
    )
    const chosen: Item[] = []
    while (chosen.length < lineCount) {
      const item = pick(pool)
      if (!chosen.includes(item)) chosen.push(item)
    }
    // Bills with missing HSN: blank out every other line (at least one).
    const hsnMissing = new Set(
      plan.missingHsn ? chosen.map((_, i) => i).filter((i) => i % 2 === 0) : []
    )

    let taxableTotal = 0n
    let cgstTotal = 0n
    let sgstTotal = 0n
    let igstTotal = 0n
    const byRate = new Map<number, { taxable: bigint; tax: bigint }>()
    const lines: PrintedLine[] = chosen.map((item, i) => {
      const unitRupees = int(item.price[0], item.price[1])
      // Hours can be fractional (x.5); goods are whole units.
      const halfUnits = item.service
        ? int(1, 4) * (random() < 0.3 ? 1 : 2)
        : int(1, 25) * 2
      const unitPaise = BigInt(unitRupees) * 100n
      const taxable = (unitPaise * BigInt(halfUnits)) / 2n
      const quantity =
        halfUnits % 2 === 0 ? String(halfUnits / 2) : `${(halfUnits - 1) / 2}.5`
      const bps = BigInt(item.rate * 100)
      const half = plan.supply === "intra" ? percentOf(taxable, bps / 2n) : 0n
      const igst = plan.supply === "inter" ? percentOf(taxable, bps) : 0n
      taxableTotal += taxable
      cgstTotal += half
      sgstTotal += half
      igstTotal += igst
      const slab = byRate.get(item.rate) ?? { taxable: 0n, tax: 0n }
      byRate.set(item.rate, {
        taxable: slab.taxable + taxable,
        tax: slab.tax + 2n * half + igst,
      })
      return {
        description: item.description,
        hsnSac: prints.hsn && !hsnMissing.has(i) ? item.hsn : null,
        quantity: prints.qtyRate ? quantity : null,
        rate: prints.qtyRate ? amount(unitPaise) : null,
        taxableAmount: amount(taxable),
        gstRate: String(item.rate),
        cgst: prints.lineTax && plan.supply === "intra" ? amount(half) : null,
        sgst: prints.lineTax && plan.supply === "intra" ? amount(half) : null,
        igst: prints.lineTax && plan.supply === "inter" ? amount(igst) : null,
      }
    })

    const exact = taxableTotal + cgstTotal + sgstTotal + igstTotal
    const roundOff = random() < 0.5
    const total = roundOff ? ((exact + 50n) / 100n) * 100n : exact
    const roundDiff = total - exact

    const month = int(4, 10)
    const day = int(1, 28)
    const billDateIso = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    const dueDateIso =
      random() < 0.5 ? addDays(billDateIso, pick([15, 30, 45])) : null
    const dateStyle = int(0, 3)
    const prefix = vendor.name
      .split(" ")
      .map((w) => w.charAt(0))
      .join("")
      .slice(0, 3)
      .toUpperCase()
    const billNumber = pick([
      `${prefix}/26-27/${String(int(1, 999)).padStart(4, "0")}`,
      `INV-${int(10000, 99999)}`,
      `${prefix}-${String(month).padStart(2, "0")}${int(100, 999)}`,
      `${int(1, 3)}${String(int(0, 9999)).padStart(4, "0")}/2026-27`,
    ])

    return {
      id,
      layout: plan.layout,
      quality: plan.quality,
      supply: plan.supply,
      vendorName: vendor.name,
      vendorAddress: `${vendor.city}, ${vendorState}`,
      vendorGstin: makeGstin(vendor.state, vendor.pan),
      buyerName: BUYER.name,
      buyerAddress,
      buyerGstin: makeGstin(placeCode, BUYER.pan),
      billNumber,
      billDateText: formatDate(billDateIso, dateStyle),
      billDateIso,
      dueDateText: dueDateIso ? formatDate(dueDateIso, dateStyle) : null,
      dueDateIso,
      placeOfSupplyText: pick(PLACE_STYLES)(placeCode, placeName),
      placeOfSupplyCode: placeCode,
      lines,
      rateSummary: [...byRate].map(([rate, slab]) => ({
        rate: String(rate),
        taxable: amount(slab.taxable),
        tax: amount(slab.tax),
      })),
      totals: {
        taxable: prints.taxableTotal ? amount(taxableTotal) : null,
        cgst:
          prints.taxTotals && plan.supply === "intra"
            ? amount(cgstTotal)
            : null,
        sgst:
          prints.taxTotals && plan.supply === "intra"
            ? amount(sgstTotal)
            : null,
        igst:
          prints.taxTotals && plan.supply === "inter"
            ? amount(igstTotal)
            : null,
        roundOff:
          roundOff && roundDiff !== 0n
            ? `${roundDiff < 0n ? "-" : "+"}${amount(roundDiff < 0n ? -roundDiff : roundDiff)}`
            : null,
        total: amount(total),
      },
      totalInWords: rupeesInWords(total),
    }
  })
}

/** The ground-truth extraction: exactly what is printed, nothing derived. */
export function expectedFor(bill: PrintedBill): Expected {
  return {
    vendor: {
      name: bill.vendorName,
      gstin: bill.vendorGstin,
      stateCode: bill.vendorGstin.slice(0, 2),
    },
    billNumber: bill.billNumber,
    billDate: bill.billDateIso,
    dueDate: bill.dueDateIso,
    placeOfSupply: bill.placeOfSupplyText,
    placeOfSupplyStateCode: bill.placeOfSupplyCode,
    currency: "INR",
    lines: bill.lines.map((line) => ({
      description: line.description,
      hsnSac: line.hsnSac,
      quantity: line.quantity,
      rate: line.rate,
      taxableAmount: line.taxableAmount,
      gstRatePercent: line.gstRate,
      cgstAmount: line.cgst,
      sgstAmount: line.sgst,
      igstAmount: line.igst,
    })),
    printedTotals: {
      taxable: bill.totals.taxable,
      cgst: bill.totals.cgst,
      sgst: bill.totals.sgst,
      igst: bill.totals.igst,
      total: bill.totals.total,
    },
  }
}

export function notesFor(bill: PrintedBill): string[] {
  const notes = [
    `${bill.lines.length} line(s)`,
    bill.supply === "intra" ? "intrastate (CGST+SGST)" : "interstate (IGST)",
  ]
  if (bill.lines.some((l) => l.hsnSac === null))
    notes.push("missing HSN on some lines")
  if (bill.totals.roundOff) notes.push("round-off")
  if (bill.totals.taxable === null) notes.push("no printed taxable subtotal")
  if (bill.quality === "image-low") notes.push("low-quality rasterised scan")
  return notes
}
