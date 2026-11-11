import "server-only"

import {
  ServiceError,
  gstr1PayloadSchema,
  parseInput,
  periodSchema,
} from "@workspace/contracts"
import type {
  GstSummary,
  GstTaxAmounts,
  Gstr1Export,
  Period,
} from "@workspace/contracts"
import { naturalBalance, paise, setOffGst } from "@workspace/ledger"
import type { TaxHeads } from "@workspace/ledger"
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import { getDb } from "../db"
import {
  creditNoteLines,
  creditNotes,
  invoiceLines,
  invoices,
  journalEntries,
  journalLines,
  ledgerAccounts,
  organizationSettings,
  periodLocks,
} from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { buildGstr1, supplyRows } from "./gstr1-build"
import type {
  CreditNoteDoc,
  DocLine,
  InvoiceDoc,
  NoInvoiceSales,
} from "./gstr1-build"
import { accountTotalsQuery, toAccountTotals } from "./reports"

// GST for one month: the summary reads the ledger for the liability and the
// documents for the breakdown; GSTR-1 reads the documents. Both load
// everything for the month in one batch, then build with pure code.

function monthRange(period: Period) {
  const [y, m] = period.split("-").map(Number)
  const last = new Date(Date.UTC(y ?? 0, m ?? 1, 0)).toISOString().slice(0, 10)
  return { from: `${period}-01`, to: last }
}

const OUTPUT = {
  igst: "gst_output_igst",
  cgst: "gst_output_cgst",
  sgst: "gst_output_sgst",
} as const
const INPUT = {
  igst: "gst_input_igst",
  cgst: "gst_input_cgst",
  sgst: "gst_input_sgst",
} as const

const amounts = (h: {
  igst: bigint
  cgst: bigint
  sgst: bigint
}): GstTaxAmounts => ({
  igst: paise(h.igst),
  cgst: paise(h.cgst),
  sgst: paise(h.sgst),
  total: paise(h.igst + h.cgst + h.sgst),
})

interface DocRow {
  docId: string
  number: string
  date: string
  partyGstin: string | null
  placeOfSupply: string
  supplyType: InvoiceDoc["supplyType"]
  reverseCharge: boolean
  total: bigint
  hsnSac: string
  description: string
  quantityMilli: bigint
  rateBps: number
  taxable: bigint
  cgst: bigint
  sgst: bigint
  igst: bigint
}

/** Groups document-line rows (ordered by document) into documents. */
function groupDocs<T extends DocRow, D>(
  rows: readonly T[],
  make: (first: T, lines: DocLine[]) => D
): D[] {
  const out: D[] = []
  let cur: { first: T; lines: DocLine[] } | null = null
  const flush = () => {
    if (cur) out.push(make(cur.first, cur.lines))
  }
  for (const r of rows) {
    if (!cur || cur.first.docId !== r.docId) {
      flush()
      cur = { first: r, lines: [] }
    }
    cur.lines.push({
      hsnSac: r.hsnSac,
      description: r.description,
      quantityMilli: r.quantityMilli,
      rateBps: r.rateBps,
      taxable: paise(r.taxable),
      cgst: paise(r.cgst),
      sgst: paise(r.sgst),
      igst: paise(r.igst),
    })
  }
  flush()
  return out
}

/** Every query the month needs, in one batch. */
async function loadMonth(orgId: string, period: Period) {
  const { from, to } = monthRange(period)
  const db = getDb()
  const inv = invoices
  const cn = creditNotes
  const credited = alias(invoices, "credited_invoice")
  const original = alias(journalEntries, "original_entry")
  const originalLine = alias(journalLines, "original_line")

  // Rule-8 sales: revenue lines tagged with a GST rate but no invoice or
  // credit note. A reversal's lines mirror the original's, line for line,
  // so they take the original line's tags (and their sign flips naturally).
  const tags = sql`coalesce(${journalLines.dimensions}, ${originalLine.dimensions})`
  const tagged = db
    .select({
      entryId: journalLines.entryId,
      rate: sql<string>`max(${tags}->>'gst_rate_bps')`.as("rate"),
      taxable:
        sql<string>`sum(${journalLines.creditPaise} - ${journalLines.debitPaise})`.as(
          "taxable"
        ),
    })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.organizationId, journalLines.organizationId),
        eq(journalEntries.id, journalLines.entryId)
      )
    )
    .leftJoin(
      original,
      and(
        eq(original.organizationId, journalEntries.organizationId),
        eq(original.id, journalEntries.reversesEntryId)
      )
    )
    .leftJoin(
      originalLine,
      and(
        eq(originalLine.organizationId, original.organizationId),
        eq(originalLine.entryId, original.id),
        eq(originalLine.lineNo, journalLines.lineNo)
      )
    )
    .where(
      and(
        eq(journalLines.organizationId, orgId),
        gte(journalLines.entryDate, from),
        lte(journalLines.entryDate, to),
        sql`${tags} ? 'gst_rate_bps'`,
        sql`not (${tags} ? 'invoice_id')`,
        sql`not (${tags} ? 'credit_note_id')`
      )
    )
    .groupBy(journalLines.entryId)
    .as("tagged")
  // Output tax per entry in the month, one row per entry (no fan-out).
  const tax = (key: string) =>
    sql<string>`coalesce(sum(${journalLines.creditPaise} - ${journalLines.debitPaise}) filter (where ${ledgerAccounts.systemKey} = ${key}), 0)`
  const entryTax = db
    .select({
      entryId: journalLines.entryId,
      igst: tax(OUTPUT.igst).as("igst"),
      cgst: tax(OUTPUT.cgst).as("cgst"),
      sgst: tax(OUTPUT.sgst).as("sgst"),
    })
    .from(journalLines)
    .innerJoin(
      ledgerAccounts,
      and(
        eq(ledgerAccounts.organizationId, journalLines.organizationId),
        eq(ledgerAccounts.id, journalLines.accountId),
        inArray(ledgerAccounts.systemKey, Object.values(OUTPUT))
      )
    )
    .where(
      and(
        eq(journalLines.organizationId, orgId),
        gte(journalLines.entryDate, from),
        lte(journalLines.entryDate, to)
      )
    )
    .groupBy(journalLines.entryId)
    .as("entry_tax")

  return db.batch([
    db
      .select({
        gstin: organizationSettings.gstin,
        stateCode: organizationSettings.stateCode,
        gstRegistered: organizationSettings.gstRegistered,
      })
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, orgId)),
    db
      .select({ id: periodLocks.id })
      .from(periodLocks)
      .where(
        and(
          eq(periodLocks.organizationId, orgId),
          eq(periodLocks.period, period)
        )
      ),
    accountTotalsQuery(orgId, { from, to }, ["asset", "liability"]),
    db
      .select({
        docId: inv.id,
        number: inv.number,
        date: inv.invoiceDate,
        partyGstin: inv.partyGstin,
        placeOfSupply: inv.placeOfSupply,
        supplyType: inv.supplyType,
        reverseCharge: inv.reverseCharge,
        total: inv.totalPaise,
        cancelled: sql<boolean>`${inv.status} = 'cancelled'`,
        hsnSac: invoiceLines.hsnSac,
        description: invoiceLines.description,
        quantityMilli: invoiceLines.quantityMilli,
        rateBps: invoiceLines.gstRateBps,
        taxable: invoiceLines.taxablePaise,
        cgst: invoiceLines.cgstPaise,
        sgst: invoiceLines.sgstPaise,
        igst: invoiceLines.igstPaise,
      })
      .from(inv)
      .innerJoin(
        invoiceLines,
        and(
          eq(invoiceLines.organizationId, inv.organizationId),
          eq(invoiceLines.invoiceId, inv.id)
        )
      )
      .where(
        and(
          eq(inv.organizationId, orgId),
          gte(inv.invoiceDate, from),
          lte(inv.invoiceDate, to)
        )
      )
      .orderBy(asc(inv.number), asc(inv.id), asc(invoiceLines.lineNo)),
    db
      .select({
        docId: cn.id,
        number: cn.number,
        date: cn.creditNoteDate,
        partyGstin: cn.partyGstin,
        placeOfSupply: cn.placeOfSupply,
        supplyType: cn.supplyType,
        reverseCharge: cn.reverseCharge,
        total: cn.totalPaise,
        invoiceTotal: credited.totalPaise,
        hsnSac: creditNoteLines.hsnSac,
        description: creditNoteLines.description,
        quantityMilli: creditNoteLines.quantityMilli,
        rateBps: creditNoteLines.gstRateBps,
        taxable: creditNoteLines.taxablePaise,
        cgst: creditNoteLines.cgstPaise,
        sgst: creditNoteLines.sgstPaise,
        igst: creditNoteLines.igstPaise,
      })
      .from(cn)
      .innerJoin(
        credited,
        and(
          eq(credited.organizationId, cn.organizationId),
          eq(credited.id, cn.invoiceId)
        )
      )
      .innerJoin(
        creditNoteLines,
        and(
          eq(creditNoteLines.organizationId, cn.organizationId),
          eq(creditNoteLines.creditNoteId, cn.id)
        )
      )
      .where(
        and(
          eq(cn.organizationId, orgId),
          gte(cn.creditNoteDate, from),
          lte(cn.creditNoteDate, to)
        )
      )
      .orderBy(asc(cn.number), asc(cn.id), asc(creditNoteLines.lineNo)),
    db
      .select({
        rate: tagged.rate,
        taxable: sql<string>`sum(${tagged.taxable})::text`,
        igst: sql<string>`coalesce(sum(${entryTax.igst}), 0)::text`,
        cgst: sql<string>`coalesce(sum(${entryTax.cgst}), 0)::text`,
        sgst: sql<string>`coalesce(sum(${entryTax.sgst}), 0)::text`,
      })
      .from(tagged)
      .leftJoin(entryTax, eq(entryTax.entryId, tagged.entryId))
      .groupBy(tagged.rate),
  ])
}

type Month = Awaited<ReturnType<typeof loadMonth>>

function docsOf(month: Month) {
  const [, , , invoiceRows, creditRows, noInvoiceRows] = month
  const invoicesOut = groupDocs(invoiceRows, (f, lines): InvoiceDoc => ({
    number: f.number,
    date: f.date,
    partyGstin: f.partyGstin,
    placeOfSupply: f.placeOfSupply,
    supplyType: f.supplyType,
    reverseCharge: f.reverseCharge,
    total: paise(f.total),
    cancelled: f.cancelled,
    lines,
  }))
  const creditOut = groupDocs(creditRows, (f, lines): CreditNoteDoc => ({
    number: f.number,
    date: f.date,
    partyGstin: f.partyGstin,
    placeOfSupply: f.placeOfSupply,
    supplyType: f.supplyType,
    reverseCharge: f.reverseCharge,
    total: paise(f.total),
    invoice: { total: paise(f.invoiceTotal) },
    lines,
  }))
  const noInvoice: NoInvoiceSales[] = noInvoiceRows.map((r) => ({
    rateBps: Number(r.rate),
    taxable: paise(BigInt(r.taxable)),
    igst: paise(BigInt(r.igst)),
    cgst: paise(BigInt(r.cgst)),
    sgst: paise(BigInt(r.sgst)),
  }))
  return { invoices: invoicesOut, creditNotes: creditOut, noInvoice }
}

const sumRows = (
  rows: readonly { taxable: bigint; igst: bigint; cgst: bigint; sgst: bigint }[]
) =>
  rows.reduce(
    (s, r) => ({
      taxable: s.taxable + r.taxable,
      igst: s.igst + r.igst,
      cgst: s.cgst + r.cgst,
      sgst: s.sgst + r.sgst,
    }),
    { taxable: 0n, igst: 0n, cgst: 0n, sgst: 0n }
  )

/**
 * GSTR-3B style summary for one month: outward supplies and credit notes by
 * category and rate, output tax and input tax credit as booked, the section
 * 49 set-off, and TDS deducted by customers.
 */
export async function getGstSummary(
  ctx: OrgContext,
  period: Period
): Promise<GstSummary> {
  assertCan(ctx, "report", "read")
  const p = parseInput(periodSchema, period)
  const month = await loadMonth(ctx.orgId, p)
  const [settings, locks, totalsRows] = month
  const org = settings[0]
  const { invoices: invs, creditNotes: cns, noInvoice } = docsOf(month)
  const live = invs.filter((i) => !i.cancelled)

  const outward = supplyRows(live, noInvoice)
  const creditRows = supplyRows(cns)
  const out = sumRows(outward)
  const back = sumRows(creditRows)

  const totals = toAccountTotals(totalsRows)
  const head = (keys: Record<keyof TaxHeads, string>): TaxHeads => {
    const of = (key: string) =>
      paise(
        totals
          .filter((t) => t.systemKey === key)
          .reduce((s, t) => s + naturalBalance(t), 0n)
      )
    return { igst: of(keys.igst), cgst: of(keys.cgst), sgst: of(keys.sgst) }
  }
  const outputTax = head(OUTPUT)
  const itc = head(INPUT)
  const setOff = setOffGst(outputTax, itc)
  const unexplained = {
    igst: outputTax.igst - (out.igst - back.igst),
    cgst: outputTax.cgst - (out.cgst - back.cgst),
    sgst: outputTax.sgst - (out.sgst - back.sgst),
  }
  const tds = totals
    .filter((t) => t.systemKey === "tds_receivable")
    .reduce((s, t) => s + naturalBalance(t), 0n)

  const warnings: string[] = []
  if (!org?.gstRegistered)
    warnings.push(
      "The organisation isn't GST-registered; there is nothing to file."
    )
  if (
    unexplained.igst !== 0n ||
    unexplained.cgst !== 0n ||
    unexplained.sgst !== 0n
  )
    warnings.push(
      "Output GST in the books doesn't match the invoices, credit notes and payments this month (see unexplainedOutputTax). Check manual entries to the output GST accounts."
    )

  return {
    period: p,
    gstin: org?.gstin ?? null,
    outward,
    creditNotes: creditRows,
    outwardTotal: {
      taxable: paise(out.taxable - back.taxable),
      ...amounts({
        igst: out.igst - back.igst,
        cgst: out.cgst - back.cgst,
        sgst: out.sgst - back.sgst,
      }),
    },
    outputTax: amounts(outputTax),
    unexplainedOutputTax: amounts(unexplained),
    inputTaxCredit: amounts(itc),
    netPayable: amounts(setOff.cashPayable),
    creditCarriedForward: amounts(setOff.creditCarriedForward),
    tdsReceivable: paise(tds),
    isLocked: locks.length > 0,
    warnings,
  }
}

/**
 * GSTR-1 draft for one month, in the GSTN offline tool's JSON format and
 * validated against it. Requires the org's GSTIN. The CA loads it into the
 * offline tool, checks it and files; Median never files.
 */
export async function exportGstr1(
  ctx: OrgContext,
  period: Period
): Promise<Gstr1Export> {
  assertCan(ctx, "report", "export")
  const p = parseInput(periodSchema, period)
  const month = await loadMonth(ctx.orgId, p)
  const org = month[0][0]
  if (!org?.gstin || !org.stateCode)
    throw new ServiceError(
      "VALIDATION",
      "Add your GSTIN in settings before exporting GSTR-1."
    )
  const docs = docsOf(month)
  const { payload, warnings } = buildGstr1({
    gstin: org.gstin,
    orgStateCode: org.stateCode,
    period: p,
    invoices: docs.invoices,
    creditNotes: docs.creditNotes,
    noInvoiceSales: docs.noInvoice,
  })
  const checked = gstr1PayloadSchema.safeParse(payload)
  // A mismatch is a bug in buildGstr1, not bad input.
  if (!checked.success)
    throw new Error(
      `GSTR-1 draft failed the offline-tool schema: ${JSON.stringify(checked.error.issues.slice(0, 5))}`
    )
  return {
    period: p,
    gstin: org.gstin,
    payload: checked.data,
    warnings: [
      "Draft only: load it into the GSTN offline tool, check every section and file from there.",
      ...warnings,
    ],
  }
}
