import "server-only"

import {
  ServiceError,
  createInvoiceInputSchema,
  idSchema,
  listInvoicesFiltersSchema,
  pageOptionsSchema,
  parseInput,
} from "@workspace/contracts"
import type {
  AgeingBuckets,
  CreateInvoiceInput,
  Invoice,
  InvoiceLine,
  InvoiceListItem,
  InvoicePreview,
  ListInvoicesFilters,
  Page,
  PageOptions,
  PartyAgeing,
  ReceivablesAgeing,
} from "@workspace/contracts"
import type { SystemAccountKey } from "@workspace/ledger"
import {
  financialYearOf,
  formatQuantityMilli,
  paise,
  periodOf,
} from "@workspace/ledger"
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm"
import type { z } from "zod"

import { getDb, withTransaction } from "../db"
import type { Db, Tx } from "../db"
import {
  auditLog,
  invoiceLines,
  invoiceSeries,
  invoices,
  ledgerAccounts,
  organizationSettings,
  parties,
  periodLocks,
} from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import {
  buildInvoice,
  documentNumber,
  invoiceStatusFor,
  outstandingOf,
  receiptAmount,
  salesEntryLines,
} from "./invoice-build"
import type { BuiltInvoice, OrgGst, SalesAccounts } from "./invoice-build"
import { postEntry } from "./ledger"
import { decodeCursor, encodeCursor } from "./pagination"
import { istDateOf } from "./posting-rules"

// Sales invoices (rules 5–7): numbered per financial year, GST per line,
// posted to the ledger in the same transaction that saves them.

export const INVOICE_PREFIX = "INV"

const SALES_KEYS = {
  receivables: "trade_receivables",
  revenue: "revenue_default",
  outputCgst: "gst_output_cgst",
  outputSgst: "gst_output_sgst",
  outputIgst: "gst_output_igst",
  roundOff: "round_off",
} as const satisfies Record<keyof SalesAccounts, SystemAccountKey>

/** The org's receivables, revenue, output GST and round-off accounts. */
export async function salesAccounts(
  db: Db | Tx,
  orgId: string
): Promise<SalesAccounts> {
  const rows = await db
    .select({ id: ledgerAccounts.id, key: ledgerAccounts.systemKey })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.organizationId, orgId),
        inArray(ledgerAccounts.systemKey, Object.values(SALES_KEYS))
      )
    )
  const byKey = new Map(rows.map((r) => [r.key, r.id]))
  const pick = (key: SystemAccountKey): string => {
    const id = byKey.get(key)
    if (!id)
      throw new ServiceError(
        "VALIDATION",
        `Your chart of accounts is missing a system account (${key}).`
      )
    return id
  }
  return {
    receivables: pick(SALES_KEYS.receivables),
    revenue: pick(SALES_KEYS.revenue),
    outputCgst: pick(SALES_KEYS.outputCgst),
    outputSgst: pick(SALES_KEYS.outputSgst),
    outputIgst: pick(SALES_KEYS.outputIgst),
    roundOff: pick(SALES_KEYS.roundOff),
  }
}

export async function orgGst(db: Db | Tx, orgId: string): Promise<OrgGst> {
  const [row] = await db
    .select({
      stateCode: organizationSettings.stateCode,
      gstRegistered: organizationSettings.gstRegistered,
      compositionScheme: organizationSettings.compositionScheme,
    })
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, orgId))
    .limit(1)
  return (
    row ?? { stateCode: null, gstRegistered: false, compositionScheme: false }
  )
}

async function customer(db: Db | Tx, orgId: string, partyId: string) {
  const [party] = await db
    .select({
      id: parties.id,
      kind: parties.kind,
      name: parties.name,
      gstin: parties.gstin,
      stateCode: parties.stateCode,
    })
    .from(parties)
    .where(and(eq(parties.organizationId, orgId), eq(parties.id, partyId)))
    .limit(1)
  if (!party) throw new ServiceError("NOT_FOUND", "Customer not found.")
  if (party.kind !== "customer")
    throw new ServiceError(
      "VALIDATION",
      `${party.name} is a vendor, not a customer.`
    )
  return party
}

/** Every revenueAccountId given must be an income account of this org. */
async function assertIncomeAccounts(
  db: Db | Tx,
  orgId: string,
  ids: readonly string[]
): Promise<void> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return
  const rows = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.organizationId, orgId),
        inArray(ledgerAccounts.id, unique),
        eq(ledgerAccounts.type, "income")
      )
    )
  if (rows.length !== unique.length)
    throw new ServiceError(
      "VALIDATION",
      "Choose an income account for each line."
    )
}

type ParsedInput = z.output<typeof createInvoiceInputSchema>

async function prepare(db: Db | Tx, orgId: string, i: ParsedInput) {
  const [org, party] = await Promise.all([
    orgGst(db, orgId),
    customer(db, orgId, i.partyId),
    assertIncomeAccounts(
      db,
      orgId,
      i.lines.flatMap((l) => (l.revenueAccountId ? [l.revenueAccountId] : []))
    ),
  ])
  return { party, built: buildInvoice(i, org, party) }
}

function lineView(l: BuiltInvoice["lines"][number]): Omit<InvoiceLine, "id"> {
  return {
    description: l.description,
    hsnSac: l.hsnSac,
    quantity: formatQuantityMilli(l.quantityMilli),
    unitPrice: l.unitPrice,
    gstRateBps: l.gstRateBps,
    taxable: l.taxable,
    cgst: l.cgst,
    sgst: l.sgst,
    igst: l.igst,
    total: l.total,
  }
}

/**
 * What createInvoice would issue, with warnings (locked period, bill of
 * supply, reverse charge without a GSTIN…). Saves nothing. Throws
 * NOT_FOUND (customer), VALIDATION.
 */
export async function previewInvoice(
  ctx: OrgContext,
  input: CreateInvoiceInput
): Promise<InvoicePreview> {
  assertCan(ctx, "ledger", "read")
  const i = parseInput(createInvoiceInputSchema, input)
  const db = getDb()
  const fy = financialYearOf(i.invoiceDate)
  const [{ built }, [series], [locked]] = await Promise.all([
    prepare(db, ctx.orgId, i),
    db
      .select({ prefix: invoiceSeries.prefix, next: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(
        and(
          eq(invoiceSeries.organizationId, ctx.orgId),
          eq(invoiceSeries.financialYear, fy)
        )
      )
      .limit(1),
    db
      .select({ id: periodLocks.id })
      .from(periodLocks)
      .where(
        and(
          eq(periodLocks.organizationId, ctx.orgId),
          eq(periodLocks.period, periodOf(i.invoiceDate))
        )
      )
      .limit(1),
  ])
  const t = built.totals
  return {
    nextNumber: documentNumber(
      series?.prefix ?? INVOICE_PREFIX,
      fy,
      series?.next ?? 1
    ),
    financialYear: fy,
    placeOfSupply: built.placeOfSupply,
    supplyType: built.supplyType,
    reverseCharge: i.reverseCharge,
    chargesGst: built.chargesGst,
    lines: built.lines.map(lineView),
    taxable: t.taxable,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    roundOff: t.roundOff,
    total: t.total,
    warnings: [
      ...(locked
        ? [
            `${periodOf(i.invoiceDate)} is locked: pick a date in an open period.`,
          ]
        : []),
      ...built.warnings,
    ],
  }
}

/** Takes the next number in the series, creating it on first use. */
async function nextInvoiceNumber(tx: Tx, orgId: string, fy: string) {
  const [row] = await tx
    .insert(invoiceSeries)
    .values({
      organizationId: orgId,
      financialYear: fy,
      prefix: INVOICE_PREFIX,
      nextNumber: 2,
    })
    .onConflictDoUpdate({
      target: [invoiceSeries.organizationId, invoiceSeries.financialYear],
      set: {
        nextNumber: sql`${invoiceSeries.nextNumber} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ prefix: invoiceSeries.prefix, next: invoiceSeries.nextNumber })
  if (!row) throw new Error("invoice_series upsert returned nothing")
  return documentNumber(row.prefix, fy, row.next - 1)
}

/**
 * Creates and posts a sales invoice: next number in the financial-year
 * series (rule 5), CGST+SGST or IGST from the place of supply (rule 6), GST
 * per line and the total rounded to the rupee (rule 7). The entry (Dr
 * receivables, Cr revenue and output GST), the invoice and an audit row are
 * written in one transaction. Throws NOT_FOUND (customer), VALIDATION,
 * PERIOD_LOCKED.
 */
export async function createInvoice(
  ctx: OrgContext,
  input: CreateInvoiceInput
): Promise<Invoice> {
  assertCan(ctx, "ledger", "post")
  const i = parseInput(createInvoiceInputSchema, input)
  const id = await withTransaction(async (tx) => {
    const [{ party, built }, accounts] = await Promise.all([
      prepare(tx, ctx.orgId, i),
      salesAccounts(tx, ctx.orgId),
    ])
    const fy = financialYearOf(i.invoiceDate)
    const number = await nextInvoiceNumber(tx, ctx.orgId, fy)
    const invoiceId = crypto.randomUUID()
    const entry = await postEntry(
      { orgId: ctx.orgId, userId: ctx.userId, source: "invoice" },
      {
        entryDate: i.invoiceDate,
        narration: `Invoice ${number} to ${party.name}`,
        sourceType: "invoice",
        sourceId: invoiceId,
        lines: salesEntryLines("invoice", built, accounts, {
          partyId: party.id,
          documentId: invoiceId,
          number,
        }),
      },
      { tx }
    )
    const t = built.totals
    await tx.insert(invoices).values({
      id: invoiceId,
      organizationId: ctx.orgId,
      number,
      financialYear: fy,
      partyId: party.id,
      invoiceDate: i.invoiceDate,
      dueDate: i.dueDate,
      placeOfSupply: built.placeOfSupply,
      supplyType: built.supplyType,
      reverseCharge: i.reverseCharge,
      taxablePaise: t.taxable,
      cgstPaise: t.cgst,
      sgstPaise: t.sgst,
      igstPaise: t.igst,
      roundOffPaise: t.roundOff,
      totalPaise: t.total,
      notes: i.notes ?? null,
      journalEntryId: entry.id,
      createdBy: ctx.userId,
    })
    await tx.insert(invoiceLines).values(
      built.lines.map((l, n) => ({
        organizationId: ctx.orgId,
        invoiceId,
        lineNo: n + 1,
        description: l.description,
        hsnSac: l.hsnSac,
        quantityMilli: l.quantityMilli,
        unitPricePaise: l.unitPrice,
        gstRateBps: l.gstRateBps,
        taxablePaise: l.taxable,
        cgstPaise: l.cgst,
        sgstPaise: l.sgst,
        igstPaise: l.igst,
        totalPaise: l.total,
      }))
    )
    await tx.insert(auditLog).values({
      organizationId: ctx.orgId,
      actorId: ctx.userId,
      action: "invoice.create",
      entity: "invoice",
      entityId: invoiceId,
      before: null,
      after: {
        number,
        partyId: party.id,
        total: String(t.total),
        journalEntryId: entry.id,
      },
      source: "web",
    })
    return invoiceId
  })
  const invoice = await getInvoice(ctx, id)
  if (!invoice) throw new Error("unreachable: invoice just created")
  return invoice
}

const headerColumns = {
  id: invoices.id,
  number: invoices.number,
  financialYear: invoices.financialYear,
  partyId: parties.id,
  partyName: parties.name,
  partyGstin: parties.gstin,
  invoiceDate: invoices.invoiceDate,
  dueDate: invoices.dueDate,
  placeOfSupply: invoices.placeOfSupply,
  supplyType: invoices.supplyType,
  reverseCharge: invoices.reverseCharge,
  taxable: invoices.taxablePaise,
  cgst: invoices.cgstPaise,
  sgst: invoices.sgstPaise,
  igst: invoices.igstPaise,
  roundOff: invoices.roundOffPaise,
  total: invoices.totalPaise,
  paid: invoices.paidPaise,
  credited: invoices.creditedPaise,
  status: invoices.status,
  notes: invoices.notes,
  journalEntryId: invoices.journalEntryId,
  createdAt: invoices.createdAt,
}

interface HeaderRow {
  readonly id: string
  readonly number: string
  readonly financialYear: string
  readonly partyId: string
  readonly partyName: string
  readonly partyGstin: string | null
  readonly invoiceDate: string
  readonly dueDate: string
  readonly placeOfSupply: string
  readonly supplyType: Invoice["supplyType"]
  readonly reverseCharge: boolean
  readonly taxable: bigint
  readonly cgst: bigint
  readonly sgst: bigint
  readonly igst: bigint
  readonly roundOff: bigint
  readonly total: bigint
  readonly paid: bigint
  readonly credited: bigint
  readonly status: Invoice["status"]
  readonly notes: string | null
  readonly journalEntryId: string | null
  readonly createdAt: Date
}

function toListItem(r: HeaderRow): InvoiceListItem {
  return {
    id: r.id,
    number: r.number,
    financialYear: r.financialYear,
    party: { id: r.partyId, name: r.partyName, gstin: r.partyGstin },
    invoiceDate: r.invoiceDate,
    dueDate: r.dueDate,
    placeOfSupply: r.placeOfSupply,
    supplyType: r.supplyType,
    reverseCharge: r.reverseCharge,
    taxable: paise(r.taxable),
    cgst: paise(r.cgst),
    sgst: paise(r.sgst),
    igst: paise(r.igst),
    roundOff: paise(r.roundOff),
    total: paise(r.total),
    paid: paise(r.paid),
    credited: paise(r.credited),
    outstanding: outstandingOf(r.total, r.paid, r.credited),
    status: r.status,
    notes: r.notes,
    journalEntryId: r.journalEntryId,
    createdAt: r.createdAt.toISOString(),
  }
}

const partyJoin = and(
  eq(parties.organizationId, invoices.organizationId),
  eq(parties.id, invoices.partyId)
)

/** Returns null when the invoice doesn't exist in this organisation. */
export async function getInvoice(
  ctx: OrgContext,
  id: string
): Promise<Invoice | null> {
  assertCan(ctx, "ledger", "read")
  const invoiceId = parseInput(idSchema, id)
  const db = getDb()
  const [[header], lines] = await db.batch([
    db
      .select(headerColumns)
      .from(invoices)
      .innerJoin(parties, partyJoin)
      .where(
        and(eq(invoices.organizationId, ctx.orgId), eq(invoices.id, invoiceId))
      )
      .limit(1),
    db
      .select({
        id: invoiceLines.id,
        description: invoiceLines.description,
        hsnSac: invoiceLines.hsnSac,
        quantityMilli: invoiceLines.quantityMilli,
        unitPrice: invoiceLines.unitPricePaise,
        gstRateBps: invoiceLines.gstRateBps,
        taxable: invoiceLines.taxablePaise,
        cgst: invoiceLines.cgstPaise,
        sgst: invoiceLines.sgstPaise,
        igst: invoiceLines.igstPaise,
        total: invoiceLines.totalPaise,
      })
      .from(invoiceLines)
      .where(
        and(
          eq(invoiceLines.organizationId, ctx.orgId),
          eq(invoiceLines.invoiceId, invoiceId)
        )
      )
      .orderBy(asc(invoiceLines.lineNo)),
  ])
  if (!header) return null
  return {
    ...toListItem(header),
    lines: lines.map((l) => ({
      id: l.id,
      description: l.description,
      hsnSac: l.hsnSac,
      quantity: formatQuantityMilli(l.quantityMilli),
      unitPrice: paise(l.unitPrice),
      gstRateBps: l.gstRateBps,
      taxable: paise(l.taxable),
      cgst: paise(l.cgst),
      sgst: paise(l.sgst),
      igst: paise(l.igst),
      total: paise(l.total),
    })),
  }
}

/** Page cursor key for the invoice list: "<invoice date>|<created at>". */
function listCursorKey(k: string): { date: string; at: Date } {
  const [date = "", at = ""] = k.split("|")
  const parsed = new Date(at)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()))
    throw new ServiceError("VALIDATION", "Invalid page cursor.")
  return { date, at: parsed }
}

/**
 * Newest first (invoice date, then when it was created), with what's still
 * outstanding on each.
 */
export async function listInvoices(
  ctx: OrgContext,
  cursor: string | null,
  filters: ListInvoicesFilters = {},
  options: PageOptions = {}
): Promise<Page<InvoiceListItem>> {
  assertCan(ctx, "ledger", "read")
  const f = parseInput(listInvoicesFiltersSchema, filters)
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = decodeCursor(cursor)
  const key = after ? listCursorKey(after.k) : null
  const rows = await getDb()
    .select(headerColumns)
    .from(invoices)
    .innerJoin(parties, partyJoin)
    .where(
      and(
        eq(invoices.organizationId, ctx.orgId),
        f.status ? eq(invoices.status, f.status) : undefined,
        f.partyId ? eq(invoices.partyId, f.partyId) : undefined,
        f.from ? gte(invoices.invoiceDate, f.from) : undefined,
        f.to ? lte(invoices.invoiceDate, f.to) : undefined,
        after && key
          ? sql`(${invoices.invoiceDate}, ${invoices.createdAt}, ${invoices.id}) < (${key.date}::date, ${key.at}, ${after.id}::uuid)`
          : undefined
      )
    )
    .orderBy(
      desc(invoices.invoiceDate),
      desc(invoices.createdAt),
      desc(invoices.id)
    )
    .limit(limit + 1)
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return {
    items: items.map(toListItem),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({
            k: `${last.invoiceDate}|${last.createdAt.toISOString()}`,
            id: last.id,
          })
        : null,
  }
}

const OPEN_STATUSES = ["issued", "partially_paid"] as const

/**
 * Outstanding receivables by customer and days past due, as of today (IST).
 * Customers are ordered by name and paginated; `totals` covers all of them.
 */
export async function getReceivablesAgeing(
  ctx: OrgContext,
  cursor: string | null,
  options: PageOptions = {}
): Promise<ReceivablesAgeing> {
  assertCan(ctx, "ledger", "read")
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = decodeCursor(cursor)
  const asOf = istDateOf(new Date())
  const outstanding = sql`greatest(${invoices.totalPaise} - ${invoices.paidPaise} - ${invoices.creditedPaise}, 0)`
  const overdue = sql`(${asOf}::date - ${invoices.dueDate})`
  const bucket = (cond: ReturnType<typeof sql>) =>
    sql<string>`coalesce(sum(${outstanding}) filter (where ${cond}), 0)::text`
  const buckets = {
    notDue: bucket(sql`${overdue} <= 0`),
    days1To30: bucket(sql`${overdue} between 1 and 30`),
    days31To60: bucket(sql`${overdue} between 31 and 60`),
    days61To90: bucket(sql`${overdue} between 61 and 90`),
    over90: bucket(sql`${overdue} > 90`),
    total: sql<string>`coalesce(sum(${outstanding}), 0)::text`,
  }
  const open = and(
    eq(invoices.organizationId, ctx.orgId),
    inArray(invoices.status, [...OPEN_STATUSES]),
    sql`${outstanding} > 0`
  )
  const db = getDb()
  const [totalsRows, partyRows] = await db.batch([
    db.select(buckets).from(invoices).where(open),
    db
      .select({
        partyId: parties.id,
        name: parties.name,
        gstin: parties.gstin,
        openInvoices: sql<number>`count(*)::int`,
        ...buckets,
      })
      .from(invoices)
      .innerJoin(parties, partyJoin)
      .where(
        and(
          open,
          after
            ? or(
                gt(parties.name, after.k),
                and(eq(parties.name, after.k), gt(parties.id, after.id))
              )
            : undefined
        )
      )
      .groupBy(parties.id, parties.name, parties.gstin)
      .orderBy(asc(parties.name), asc(parties.id))
      .limit(limit + 1),
  ])
  const toBuckets = (
    r: Record<keyof AgeingBuckets, string>
  ): AgeingBuckets => ({
    notDue: paise(BigInt(r.notDue)),
    days1To30: paise(BigInt(r.days1To30)),
    days31To60: paise(BigInt(r.days31To60)),
    days61To90: paise(BigInt(r.days61To90)),
    over90: paise(BigInt(r.over90)),
    total: paise(BigInt(r.total)),
  })
  const zero = paise(0n)
  const page = partyRows.slice(0, limit)
  const last = page.at(-1)
  const totals = totalsRows[0]
  return {
    asOf,
    totals: totals
      ? toBuckets(totals)
      : {
          notDue: zero,
          days1To30: zero,
          days31To60: zero,
          days61To90: zero,
          over90: zero,
          total: zero,
        },
    parties: {
      items: page.map((r): PartyAgeing => ({
        party: { id: r.partyId, name: r.name, gstin: r.gstin },
        openInvoices: r.openInvoices,
        ...toBuckets(r),
      })),
      nextCursor:
        partyRows.length > limit && last
          ? encodeCursor({ k: last.name, id: last.partyId })
          : null,
    },
  }
}

/**
 * Applies a posted receipt to its invoice: what the entry credits to the
 * customer's receivable counts as paid (with TDS, the whole invoice), and
 * the status follows. Internal: called in the transaction that posts the
 * receipt. Cancelled invoices are left alone.
 */
export async function applyInvoiceReceipt(
  tx: Tx,
  actor: {
    readonly orgId: string
    readonly userId: string | null
    readonly source: string
  },
  invoiceId: string,
  entry: {
    readonly id: string
    readonly lines: readonly {
      readonly accountId: string
      readonly partyId?: string | null
      readonly credit: bigint
    }[]
  }
): Promise<void> {
  const [[before], [receivables]] = await Promise.all([
    tx
      .select({
        partyId: invoices.partyId,
        total: invoices.totalPaise,
        paid: invoices.paidPaise,
        credited: invoices.creditedPaise,
        status: invoices.status,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, actor.orgId),
          eq(invoices.id, invoiceId)
        )
      )
      .for("update"),
    tx
      .select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.organizationId, actor.orgId),
          eq(ledgerAccounts.systemKey, SALES_KEYS.receivables)
        )
      )
      .limit(1),
  ])
  if (!before || !receivables || before.status === "cancelled") return
  const amount = receiptAmount(entry.lines, receivables.id, before.partyId)
  if (amount <= 0n) return
  const entryId = entry.id
  const paid = before.paid + amount
  const status = invoiceStatusFor(before.total, paid, before.credited)
  await tx
    .update(invoices)
    .set({ paidPaise: paid, status, updatedAt: new Date() })
    .where(
      and(
        eq(invoices.organizationId, actor.orgId),
        eq(invoices.id, invoiceId),
        ne(invoices.status, "cancelled")
      )
    )
  await tx.insert(auditLog).values({
    organizationId: actor.orgId,
    actorId: actor.userId,
    action: "invoice.receipt",
    entity: "invoice",
    entityId: invoiceId,
    before: { paid: String(before.paid), status: before.status },
    after: { paid: String(paid), status, journalEntryId: entryId },
    source: actor.source,
  })
}
