import type {
  GstSupplyCategory,
  GstSupplyRow,
  Gstr1Payload,
  InvoiceSupplyType,
  Money,
} from "@workspace/contracts"
import { paise } from "@workspace/ledger"

// Pure GSTR-1 and GST summary building from the month's documents. The
// service loads the rows; everything here is unit-tested.

/**
 * B2C interstate invoices above this go to B2CL individually (₹1 lakh since
 * 1 August 2024, Notification 12/2024-Central Tax); the rest to B2CS.
 */
export const B2CL_THRESHOLD_PAISE = 1_00_000_00n

export interface DocLine {
  readonly hsnSac: string
  readonly description: string
  readonly quantityMilli: bigint
  readonly rateBps: number
  readonly taxable: Money
  readonly cgst: Money
  readonly sgst: Money
  readonly igst: Money
}

export interface SalesDoc {
  readonly number: string
  /** YYYY-MM-DD */
  readonly date: string
  readonly partyGstin: string | null
  readonly placeOfSupply: string
  readonly supplyType: InvoiceSupplyType
  readonly reverseCharge: boolean
  readonly total: Money
  readonly lines: readonly DocLine[]
}

export interface InvoiceDoc extends SalesDoc {
  readonly cancelled: boolean
}

export interface CreditNoteDoc extends SalesDoc {
  /** The invoice credited: decides B2B/B2CL/B2CS/export like the invoice. */
  readonly invoice: { readonly total: Money }
}

/** Sales from payments without an invoice (rule 8), by rate. */
export interface NoInvoiceSales {
  readonly rateBps: number
  readonly taxable: Money
  readonly cgst: Money
  readonly sgst: Money
  readonly igst: Money
}

/** Exact rupees from paise for the JSON (no float arithmetic). */
export function rupeesOf(amount: bigint): number {
  const neg = amount < 0n
  const abs = neg ? -amount : amount
  return Number(
    `${neg ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`
  )
}

const pct = (bps: number) => bps / 100
const dmy = (iso: string) =>
  `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`

type Section = "b2b" | "b2cl" | "b2cs" | "exp"

function sectionOf(doc: SalesDoc, value: bigint): Section {
  if (
    doc.supplyType === "export_with_payment" ||
    doc.supplyType === "export_lut"
  )
    return "exp"
  if (doc.partyGstin || doc.supplyType === "sez") return "b2b"
  if (doc.supplyType === "interstate" && value > B2CL_THRESHOLD_PAISE)
    return "b2cl"
  return "b2cs"
}

export function categoryOf(doc: SalesDoc): GstSupplyCategory {
  if (doc.supplyType === "export_with_payment") return "export_with_payment"
  if (doc.supplyType === "export_lut") return "export_lut"
  if (doc.supplyType === "sez") return "sez"
  if (doc.reverseCharge) return "reverse_charge"
  return "taxable"
}

interface Sums {
  taxable: bigint
  cgst: bigint
  sgst: bigint
  igst: bigint
}
const zero = (): Sums => ({ taxable: 0n, cgst: 0n, sgst: 0n, igst: 0n })
const add = (a: Sums, b: DocLine | NoInvoiceSales | Sums, sign = 1n) => {
  a.taxable += sign * b.taxable
  a.cgst += sign * b.cgst
  a.sgst += sign * b.sgst
  a.igst += sign * b.igst
}

/** Lines grouped by rate, in rate order: one GSTR-1 item per rate. */
function byRate(lines: readonly DocLine[]): [number, Sums][] {
  const m = new Map<number, Sums>()
  for (const l of lines) {
    const s = m.get(l.rateBps) ?? zero()
    add(s, l)
    m.set(l.rateBps, s)
  }
  return [...m.entries()].sort(([a], [b]) => a - b)
}

function items(lines: readonly DocLine[], intrastate: boolean) {
  return byRate(lines).map(([rate, s], i) => ({
    num: i + 1,
    itm_det: intrastate
      ? {
          txval: rupeesOf(s.taxable),
          rt: pct(rate),
          camt: rupeesOf(s.cgst),
          samt: rupeesOf(s.sgst),
          csamt: 0,
        }
      : {
          txval: rupeesOf(s.taxable),
          rt: pct(rate),
          iamt: rupeesOf(s.igst),
          csamt: 0,
        },
  }))
}

function invType(doc: SalesDoc): "R" | "SEWP" {
  return doc.supplyType === "sez" ? "SEWP" : "R"
}

/** Summary rows by category and rate; `sign` -1 never used: credit notes are their own list. */
export function supplyRows(
  docs: readonly SalesDoc[],
  noInvoice: readonly NoInvoiceSales[] = []
): GstSupplyRow[] {
  const m = new Map<
    string,
    { cat: GstSupplyCategory; rate: number; s: Sums; docs: Set<string> }
  >()
  const bump = (
    cat: GstSupplyCategory,
    rate: number,
    line: DocLine | NoInvoiceSales,
    doc: string | null
  ) => {
    const key = `${cat}:${rate}`
    const row = m.get(key) ?? { cat, rate, s: zero(), docs: new Set<string>() }
    add(row.s, line)
    if (doc) row.docs.add(doc)
    m.set(key, row)
  }
  for (const d of docs)
    for (const l of d.lines) bump(categoryOf(d), l.rateBps, l, d.number)
  for (const n of noInvoice) bump("no_invoice", n.rateBps, n, null)
  const order: GstSupplyCategory[] = [
    "taxable",
    "reverse_charge",
    "sez",
    "export_with_payment",
    "export_lut",
    "no_invoice",
  ]
  return [...m.values()]
    .sort(
      (a, b) => order.indexOf(a.cat) - order.indexOf(b.cat) || a.rate - b.rate
    )
    .map((r) => ({
      category: r.cat,
      rateBps: r.rate,
      taxable: paise(r.s.taxable),
      igst: paise(r.s.igst),
      cgst: paise(r.s.cgst),
      sgst: paise(r.s.sgst),
      total: paise(r.s.igst + r.s.cgst + r.s.sgst),
      documentCount: r.docs.size,
    }))
}

function docIssue(
  numbers: readonly string[],
  cancelled: number,
  docNum: number
) {
  if (numbers.length === 0) return null
  const sorted = [...numbers].sort()
  return {
    doc_num: docNum,
    docs: [
      {
        num: 1,
        from: sorted[0] ?? "",
        to: sorted.at(-1) ?? "",
        totnum: sorted.length,
        cancel: cancelled,
        net_issue: sorted.length - cancelled,
      },
    ],
  }
}

/** Unit quantity code: services (SAC, "99…") have none. */
const uqcOf = (hsn: string) => (hsn.startsWith("99") ? "NA" : "OTH")

export interface Gstr1Input {
  readonly gstin: string
  readonly orgStateCode: string
  /** YYYY-MM */
  readonly period: string
  readonly invoices: readonly InvoiceDoc[]
  readonly creditNotes: readonly CreditNoteDoc[]
  readonly noInvoiceSales: readonly NoInvoiceSales[]
}

/**
 * The GSTR-1 payload and the warnings a CA must act on. Cancelled invoices
 * are left out of every section and counted in doc_issue. B2C credit notes
 * are netted into B2CS, as the return expects.
 */
export function buildGstr1(input: Gstr1Input): {
  payload: Gstr1Payload
  warnings: string[]
} {
  const warnings: string[] = []
  const live = input.invoices.filter((i) => !i.cancelled)
  const b2b = new Map<string, Gstr1Payload["b2b"][number]["inv"]>()
  const b2cl = new Map<string, Gstr1Payload["b2cl"][number]["inv"]>()
  const b2cs = new Map<
    string,
    { sply: "INTRA" | "INTER"; pos: string; rate: number; s: Sums }
  >()
  const exp = new Map<"WPAY" | "WOPAY", Gstr1Payload["exp"][number]["inv"]>()
  const cdnr = new Map<string, Gstr1Payload["cdnr"][number]["nt"]>()
  const cdnur: Gstr1Payload["cdnur"] = []
  const hsn = new Map<
    string,
    { hsn: string; rate: number; desc: string; qtyMilli: bigint; s: Sums }
  >()

  const toB2cs = (doc: SalesDoc, sign: bigint) => {
    const intra = doc.supplyType === "intrastate"
    for (const [rate, s] of byRate(doc.lines)) {
      const key = `${doc.placeOfSupply}:${rate}:${intra}`
      const row = b2cs.get(key) ?? {
        sply: intra ? ("INTRA" as const) : ("INTER" as const),
        pos: doc.placeOfSupply,
        rate,
        s: zero(),
      }
      add(row.s, s, sign)
      b2cs.set(key, row)
    }
  }
  const toHsn = (doc: SalesDoc, sign: bigint) => {
    for (const l of doc.lines) {
      if (!/^[0-9]{4,8}$/.test(l.hsnSac)) {
        warnings.push(
          `${doc.number}: HSN/SAC "${l.hsnSac}" isn't 4–8 digits; it's left out of the HSN summary.`
        )
        continue
      }
      const key = `${l.hsnSac}:${l.rateBps}`
      const row = hsn.get(key) ?? {
        hsn: l.hsnSac,
        rate: l.rateBps,
        desc: l.description.slice(0, 30),
        qtyMilli: 0n,
        s: zero(),
      }
      add(row.s, l, sign)
      row.qtyMilli += sign * l.quantityMilli
      hsn.set(key, row)
    }
  }

  for (const inv of live) {
    const intra = inv.supplyType === "intrastate"
    const section = sectionOf(inv, inv.total)
    const base = {
      inum: inv.number,
      idt: dmy(inv.date),
      val: rupeesOf(inv.total),
    }
    toHsn(inv, 1n)
    if (section === "b2b") {
      if (!inv.partyGstin) {
        warnings.push(
          `${inv.number}: SEZ supply to a customer without a GSTIN; add it before filing. Left out of B2B.`
        )
        continue
      }
      const list = b2b.get(inv.partyGstin) ?? []
      list.push({
        ...base,
        pos: inv.placeOfSupply,
        rchrg: inv.reverseCharge ? "Y" : "N",
        inv_typ: invType(inv),
        itms: items(inv.lines, intra),
      })
      b2b.set(inv.partyGstin, list)
    } else if (section === "b2cl") {
      const list = b2cl.get(inv.placeOfSupply) ?? []
      list.push({ ...base, itms: items(inv.lines, false) })
      b2cl.set(inv.placeOfSupply, list)
    } else if (section === "exp") {
      const typ = inv.supplyType === "export_lut" ? "WOPAY" : "WPAY"
      const list = exp.get(typ) ?? []
      list.push({
        ...base,
        itms: byRate(inv.lines).map(([rate, s]) => ({
          txval: rupeesOf(s.taxable),
          rt: pct(rate),
          iamt: rupeesOf(s.igst),
          csamt: 0,
        })),
      })
      exp.set(typ, list)
      warnings.push(
        `${inv.number}: export; add the port code, shipping bill number and date in the offline tool.`
      )
    } else {
      toB2cs(inv, 1n)
    }
    if (inv.reverseCharge && !inv.partyGstin)
      warnings.push(
        `${inv.number}: reverse charge on a customer without a GSTIN; check the invoice.`
      )
  }

  for (const cn of input.creditNotes) {
    const intra = cn.supplyType === "intrastate"
    const section = sectionOf(cn, cn.invoice.total)
    const base = {
      ntty: "C" as const,
      nt_num: cn.number,
      nt_dt: dmy(cn.date),
      val: rupeesOf(cn.total),
    }
    toHsn(cn, -1n)
    if (section === "b2b" && cn.partyGstin) {
      const list = cdnr.get(cn.partyGstin) ?? []
      list.push({
        ...base,
        pos: cn.placeOfSupply,
        rchrg: cn.reverseCharge ? "Y" : "N",
        inv_typ: invType(cn),
        itms: items(cn.lines, intra),
      })
      cdnr.set(cn.partyGstin, list)
    } else if (section === "b2cl" || section === "exp") {
      cdnur.push({
        ...base,
        typ:
          section === "b2cl"
            ? "B2CL"
            : cn.supplyType === "export_lut"
              ? "EXPWOP"
              : "EXPWP",
        ...(section === "b2cl" ? { pos: cn.placeOfSupply } : {}),
        itms: items(cn.lines, false),
      })
    } else if (section === "b2b") {
      warnings.push(
        `${cn.number}: credit note for an SEZ customer without a GSTIN; add it in the offline tool.`
      )
    } else {
      toB2cs(cn, -1n)
    }
  }

  let noInvoiceTaxable = 0n
  for (const n of input.noInvoiceSales) {
    const key = `${input.orgStateCode}:${n.rateBps}:true`
    const row = b2cs.get(key) ?? {
      sply: "INTRA" as const,
      pos: input.orgStateCode,
      rate: n.rateBps,
      s: zero(),
    }
    add(row.s, n)
    b2cs.set(key, row)
    noInvoiceTaxable += n.taxable
  }
  if (noInvoiceTaxable !== 0n)
    warnings.push(
      `Sales without an invoice (taxable ₹${rupeesOf(noInvoiceTaxable).toFixed(2)}) are in B2CS at your state. They have no HSN, so add them to the HSN summary in the offline tool.`
    )
  for (const row of b2cs.values())
    if (row.s.taxable < 0n)
      warnings.push(
        `B2CS ${row.pos} at ${pct(row.rate)}%: credit notes exceed sales this month; check before filing.`
      )

  const cancelled = input.invoices.filter((i) => i.cancelled).length
  const docDet = [
    docIssue(
      input.invoices.map((i) => i.number),
      cancelled,
      1
    ),
    docIssue(
      input.creditNotes.map((c) => c.number),
      0,
      5
    ),
  ].filter((d) => d !== null)

  const payload: Gstr1Payload = {
    gstin: input.gstin,
    fp: `${input.period.slice(5, 7)}${input.period.slice(0, 4)}`,
    b2b: [...b2b].map(([ctin, inv]) => ({ ctin, inv })),
    b2cl: [...b2cl].map(([pos, inv]) => ({ pos, inv })),
    b2cs: [...b2cs.values()].map((r) => ({
      sply_ty: r.sply,
      pos: r.pos,
      typ: "OE" as const,
      txval: rupeesOf(r.s.taxable),
      rt: pct(r.rate),
      ...(r.sply === "INTRA"
        ? { camt: rupeesOf(r.s.cgst), samt: rupeesOf(r.s.sgst) }
        : { iamt: rupeesOf(r.s.igst) }),
      csamt: 0,
    })),
    exp: [...exp].map(([exp_typ, inv]) => ({ exp_typ, inv })),
    cdnr: [...cdnr].map(([ctin, nt]) => ({ ctin, nt })),
    cdnur,
    hsn: {
      data: [...hsn.values()]
        .sort((a, b) =>
          a.hsn < b.hsn ? -1 : a.hsn > b.hsn ? 1 : a.rate - b.rate
        )
        .map((r, i) => ({
          num: i + 1,
          hsn_sc: r.hsn,
          desc: r.desc,
          uqc: uqcOf(r.hsn),
          // Quantities aren't money; credit notes can take them below zero.
          qty:
            uqcOf(r.hsn) === "NA" || r.qtyMilli < 0n
              ? 0
              : Number(r.qtyMilli) / 1000,
          rt: pct(r.rate),
          txval: rupeesOf(r.s.taxable),
          iamt: rupeesOf(r.s.igst),
          camt: rupeesOf(r.s.cgst),
          samt: rupeesOf(r.s.sgst),
          csamt: 0,
        })),
    },
    doc_issue: { doc_det: docDet },
  }
  return { payload, warnings }
}
