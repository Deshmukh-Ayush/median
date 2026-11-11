import "server-only"

import {
  ServiceError,
  createCreditNoteInputSchema,
  idSchema,
  pageOptionsSchema,
  parseInput,
} from "@workspace/contracts"
import type {
  CreateCreditNoteInput,
  CreditNote,
  CreditNotePreview,
  CreditNoteReason,
  Page,
  PageOptions,
} from "@workspace/contracts"
import {
  InvalidMoneyError,
  computeDocument,
  financialYearOf,
  formatQuantityMilli,
  paise,
  quantityMilliOf,
} from "@workspace/ledger"
import type { Money } from "@workspace/ledger"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { getDb, withTransaction } from "../db"
import type { Db, Tx } from "../db"
import {
  auditLog,
  creditNoteLines,
  creditNoteSeries,
  creditNotes,
  invoiceLines,
  invoices,
  periodLocks,
} from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import {
  documentNumber,
  invoiceStatusFor,
  planCreditLines,
  planRefundCredit,
  salesEntryLines,
} from "./invoice-build"
import type { CreditRequest, CreditableLine } from "./invoice-build"
import { salesAccounts } from "./invoices"
import { postEntry } from "./ledger"
import type { LedgerActor } from "./ledger"
import { dateTimeCursorKey, decodeCursor, encodeCursor } from "./pagination"

// Credit notes against sales invoices. Rule 10: a refund of an invoiced
// sale is a credit note (it reduces output GST and appears in GSTR-1), not a
// reversal. Each credit note follows its invoice's GST treatment.

export const CREDIT_NOTE_PREFIX = "CN"

interface InsertCreditNote {
  readonly invoiceId: string
  readonly creditNoteDate: string
  readonly reason: CreditNoteReason
  readonly notes: string | null
  /** Lines to credit, or "refund" to split a refund amount (rule 10). */
  readonly credit:
    | { readonly kind: "lines"; readonly requests: readonly CreditRequest[] }
    | { readonly kind: "refund"; readonly amount: Money }
  readonly sourceRecordId: string | null
}

type PlanInput = Omit<InsertCreditNote, "notes" | "sourceRecordId" | "reason">

/**
 * The credit note's lines and totals, from the invoice and what's already
 * credited: the maths createCreditNote and previewCreditNote share. With
 * `lock`, the invoice row is locked for the caller's transaction. Throws
 * NOT_FOUND, VALIDATION.
 */
async function planCreditNote(
  db: Db | Tx,
  orgId: string,
  c: PlanInput,
  lock: boolean
) {
  const invoiceQuery = db
    .select({
      id: invoices.id,
      number: invoices.number,
      partyId: invoices.partyId,
      partyName: invoices.partyName,
      partyGstin: invoices.partyGstin,
      partyAddress: invoices.partyAddress,
      partyStateCode: invoices.partyStateCode,
      invoiceDate: invoices.invoiceDate,
      placeOfSupply: invoices.placeOfSupply,
      supplyType: invoices.supplyType,
      reverseCharge: invoices.reverseCharge,
      tax: sql<string>`(${invoices.cgstPaise} + ${invoices.sgstPaise} + ${invoices.igstPaise})::text`,
      total: invoices.totalPaise,
      paid: invoices.paidPaise,
      credited: invoices.creditedPaise,
    })
    .from(invoices)
    .where(
      and(eq(invoices.organizationId, orgId), eq(invoices.id, c.invoiceId))
    )
  const [invoice] = lock ? await invoiceQuery.for("update") : await invoiceQuery
  if (!invoice) throw new ServiceError("NOT_FOUND", "Invoice not found.")
  if (c.creditNoteDate < invoice.invoiceDate)
    throw new ServiceError(
      "VALIDATION",
      "A credit note can't be dated before its invoice."
    )

  const [lineRows, creditedRows, accounts] = await Promise.all([
    db
      .select({
        id: invoiceLines.id,
        lineNo: invoiceLines.lineNo,
        description: invoiceLines.description,
        hsnSac: invoiceLines.hsnSac,
        quantityMilli: invoiceLines.quantityMilli,
        unitPrice: invoiceLines.unitPricePaise,
        gstRateBps: invoiceLines.gstRateBps,
        revenueAccountId: invoiceLines.revenueAccountId,
        taxable: invoiceLines.taxablePaise,
      })
      .from(invoiceLines)
      .where(
        and(
          eq(invoiceLines.organizationId, orgId),
          eq(invoiceLines.invoiceId, invoice.id)
        )
      )
      .orderBy(asc(invoiceLines.lineNo)),
    db
      .select({
        invoiceLineId: creditNoteLines.invoiceLineId,
        taxable: sql<string>`sum(${creditNoteLines.taxablePaise})::text`,
      })
      .from(creditNoteLines)
      .innerJoin(
        creditNotes,
        and(
          eq(creditNotes.organizationId, creditNoteLines.organizationId),
          eq(creditNotes.id, creditNoteLines.creditNoteId)
        )
      )
      .where(
        and(
          eq(creditNoteLines.organizationId, orgId),
          eq(creditNotes.invoiceId, invoice.id)
        )
      )
      .groupBy(creditNoteLines.invoiceLineId),
    salesAccounts(db, orgId),
  ])
  const creditedByLine = new Map(
    creditedRows.map((r) => [r.invoiceLineId, BigInt(r.taxable)])
  )
  const creditable: CreditableLine[] = lineRows.map((l) => ({
    ...l,
    unitPrice: paise(l.unitPrice),
    taxable: paise(l.taxable),
    creditedTaxable: paise(creditedByLine.get(l.id) ?? 0n),
  }))
  // The invoice's GST treatment: CGST+SGST or IGST, and whether it charged any.
  const supply = {
    intrastate: invoice.supplyType === "intrastate",
    chargesGst: BigInt(invoice.tax) > 0n,
  }

  let requests: readonly CreditRequest[]
  if (c.credit.kind === "refund") {
    const plan = planRefundCredit(creditable, c.credit.amount, supply)
    if (!plan.ok) throw new ServiceError("VALIDATION", plan.reason)
    requests = plan.requests
  } else {
    requests = c.credit.requests
  }
  const planned = planCreditLines(creditable, requests)
  let computed: ReturnType<typeof computeDocument>
  try {
    computed = computeDocument(
      planned.map((l) => ({
        quantityMilli: l.quantityMilli,
        unitPrice: l.unitPrice,
        rateBps: l.gstRateBps,
      })),
      supply,
      c.credit.kind === "refund" ? { exactTotal: c.credit.amount } : {}
    )
  } catch (error) {
    if (error instanceof InvalidMoneyError)
      throw new ServiceError(
        "VALIDATION",
        "The refund doesn't split cleanly across the invoice's lines: choose the lines."
      )
    throw error
  }
  const t = computed.totals
  if (invoice.credited + t.total > invoice.total)
    throw new ServiceError(
      "VALIDATION",
      "Credit notes can't add up to more than the invoice."
    )

  const lines = planned.map((l, i) => {
    const tax = computed.lines[i]
    if (!tax) throw new Error("unreachable")
    return { ...l, ...tax }
  })
  return { invoice, accounts, lines, totals: computed.totals }
}

/**
 * Writes a credit note, its entry (Dr revenue + output GST, Cr the
 * customer's receivable), the invoice's new credited amount and status, and
 * an audit row, inside the caller's transaction. Throws NOT_FOUND,
 * VALIDATION, PERIOD_LOCKED.
 */
async function insertCreditNote(
  tx: Tx,
  actor: LedgerActor,
  c: InsertCreditNote
): Promise<{ id: string; number: string; total: Money; partyId: string }> {
  const { orgId } = actor
  const {
    invoice,
    accounts,
    lines,
    totals: t,
  } = await planCreditNote(tx, orgId, c, true)
  const fy = financialYearOf(c.creditNoteDate)
  const [series] = await tx
    .insert(creditNoteSeries)
    .values({
      organizationId: orgId,
      financialYear: fy,
      prefix: CREDIT_NOTE_PREFIX,
      nextNumber: 2,
    })
    .onConflictDoUpdate({
      target: [creditNoteSeries.organizationId, creditNoteSeries.financialYear],
      set: {
        nextNumber: sql`${creditNoteSeries.nextNumber} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({
      prefix: creditNoteSeries.prefix,
      next: creditNoteSeries.nextNumber,
    })
  if (!series) throw new Error("credit_note_series upsert returned nothing")
  const number = documentNumber(series.prefix, fy, series.next - 1)
  const id = crypto.randomUUID()

  const entry = await postEntry(
    actor,
    {
      entryDate: c.creditNoteDate,
      narration: `Credit note ${number} against ${invoice.number}`,
      sourceType: "credit_note",
      sourceId: id,
      lines: salesEntryLines("credit_note", { lines, totals: t }, accounts, {
        partyId: invoice.partyId,
        documentId: id,
        number,
      }),
    },
    { tx }
  )
  await tx.insert(creditNotes).values({
    id,
    organizationId: orgId,
    number,
    financialYear: fy,
    invoiceId: invoice.id,
    partyId: invoice.partyId,
    // The recipient as printed on the invoice it corrects.
    partyName: invoice.partyName,
    partyGstin: invoice.partyGstin,
    partyAddress: invoice.partyAddress,
    partyStateCode: invoice.partyStateCode,
    creditNoteDate: c.creditNoteDate,
    reason: c.reason,
    placeOfSupply: invoice.placeOfSupply,
    supplyType: invoice.supplyType,
    reverseCharge: invoice.reverseCharge,
    taxablePaise: t.taxable,
    cgstPaise: t.cgst,
    sgstPaise: t.sgst,
    igstPaise: t.igst,
    roundOffPaise: t.roundOff,
    totalPaise: t.total,
    sourceRecordId: c.sourceRecordId,
    notes: c.notes,
    journalEntryId: entry.id,
    createdBy: actor.userId,
  })
  await tx.insert(creditNoteLines).values(
    lines.map((l, n) => ({
      organizationId: orgId,
      creditNoteId: id,
      lineNo: n + 1,
      invoiceLineId: l.invoiceLineId,
      description: l.description,
      hsnSac: l.hsnSac,
      quantityMilli: l.byValue ? 0n : l.quantityMilli,
      unitPricePaise: l.unitPrice,
      gstRateBps: l.gstRateBps,
      taxablePaise: l.taxable,
      cgstPaise: l.cgst,
      sgstPaise: l.sgst,
      igstPaise: l.igst,
      totalPaise: l.total,
    }))
  )
  const credited = invoice.credited + t.total
  const status = invoiceStatusFor(invoice.total, invoice.paid, credited)
  await tx
    .update(invoices)
    .set({ creditedPaise: credited, status, updatedAt: new Date() })
    .where(and(eq(invoices.organizationId, orgId), eq(invoices.id, invoice.id)))
  await tx.insert(auditLog).values({
    organizationId: orgId,
    actorId: actor.userId,
    action: "credit_note.create",
    entity: "credit_note",
    entityId: id,
    before: null,
    after: {
      number,
      invoiceId: invoice.id,
      reason: c.reason,
      total: String(t.total),
      journalEntryId: entry.id,
      invoiceStatus: status,
    },
    source: actor.source,
  })
  return { id, number, total: t.total, partyId: invoice.partyId }
}

function requestsOf(
  lines: z.output<typeof createCreditNoteInputSchema>["lines"]
): CreditRequest[] {
  return lines.map((l): CreditRequest =>
    "quantity" in l
      ? {
          invoiceLineId: l.invoiceLineId,
          quantityMilli: quantityMilliOf(l.quantity),
        }
      : { invoiceLineId: l.invoiceLineId, taxable: l.taxable }
  )
}

/**
 * What createCreditNote would issue for the same input (lines, tax,
 * round-off, totals, the next number and what's left outstanding),
 * computed by the same code; nothing is saved. Throws NOT_FOUND and
 * VALIDATION like createCreditNote; a locked month is a warning here.
 */
export async function previewCreditNote(
  ctx: OrgContext,
  input: CreateCreditNoteInput
): Promise<CreditNotePreview> {
  assertCan(ctx, "ledger", "post")
  const i = parseInput(createCreditNoteInputSchema, input)
  const db = getDb()
  const plan = await planCreditNote(
    db,
    ctx.orgId,
    {
      invoiceId: i.invoiceId,
      creditNoteDate: i.creditNoteDate,
      credit: { kind: "lines", requests: requestsOf(i.lines) },
    },
    false
  )
  const fy = financialYearOf(i.creditNoteDate)
  const [[series], locks] = await db.batch([
    db
      .select({
        prefix: creditNoteSeries.prefix,
        next: creditNoteSeries.nextNumber,
      })
      .from(creditNoteSeries)
      .where(
        and(
          eq(creditNoteSeries.organizationId, ctx.orgId),
          eq(creditNoteSeries.financialYear, fy)
        )
      ),
    db
      .select({ id: periodLocks.id })
      .from(periodLocks)
      .where(
        and(
          eq(periodLocks.organizationId, ctx.orgId),
          eq(periodLocks.period, i.creditNoteDate.slice(0, 7))
        )
      ),
  ])
  const t = plan.totals
  const inv = plan.invoice
  const outstandingAfter = inv.total - inv.paid - inv.credited - t.total
  return {
    nextNumber: documentNumber(
      series?.prefix ?? CREDIT_NOTE_PREFIX,
      fy,
      series?.next ?? 1
    ),
    invoice: {
      id: inv.id,
      number: inv.number,
      total: paise(inv.total),
      credited: paise(inv.credited),
      outstandingAfter: paise(outstandingAfter > 0n ? outstandingAfter : 0n),
    },
    supplyType: inv.supplyType,
    lines: plan.lines.map((l) => ({
      invoiceLineId: l.invoiceLineId,
      description: l.description,
      hsnSac: l.hsnSac,
      quantity: l.byValue ? null : formatQuantityMilli(l.quantityMilli),
      unitPrice: l.unitPrice,
      gstRateBps: l.gstRateBps,
      taxable: l.taxable,
      cgst: l.cgst,
      sgst: l.sgst,
      igst: l.igst,
      total: l.total,
    })),
    taxable: t.taxable,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    roundOff: t.roundOff,
    total: t.total,
    warnings:
      locks.length > 0
        ? [
            `${i.creditNoteDate.slice(0, 7)} is locked: date the credit note in an open month.`,
          ]
        : [],
  }
}

/**
 * Issues a credit note against an invoice: returned quantities or credited
 * values per invoice line, taxed like the invoice (rule 6) and rounded to
 * the rupee (rule 7), numbered per financial year (rule 5). Posts the
 * mirror of the invoice's entry, lowers what's outstanding, and writes an
 * audit row, in one transaction. For a refund already paid out by bank
 * transfer, match the bank line separately. Throws NOT_FOUND, VALIDATION
 * (line over-credited, dated before the invoice), PERIOD_LOCKED.
 */
export async function createCreditNote(
  ctx: OrgContext,
  input: CreateCreditNoteInput
): Promise<CreditNote> {
  assertCan(ctx, "ledger", "post")
  const i = parseInput(createCreditNoteInputSchema, input)
  const requests = requestsOf(i.lines)
  const { id } = await withTransaction((tx) =>
    insertCreditNote(
      tx,
      { orgId: ctx.orgId, userId: ctx.userId, source: "web" },
      {
        invoiceId: i.invoiceId,
        creditNoteDate: i.creditNoteDate,
        reason: i.reason,
        notes: i.notes ?? null,
        credit: { kind: "lines", requests },
        sourceRecordId: null,
      }
    )
  )
  const note = await getCreditNote(ctx, id)
  if (!note) throw new Error("unreachable: credit note just created")
  return note
}

/**
 * Rule 10 for a Razorpay refund of an invoiced sale: a credit note for the
 * refund amount (split across the invoice's lines, see planRefundCredit),
 * then the payout (Dr the customer's receivable, Cr Razorpay clearing).
 * Runs in the sync's transaction; returns the payout entry, which the
 * refund record is booked to. Throws VALIDATION when the refund can't be
 * split safely (the sync then sends it to the inbox), PERIOD_LOCKED.
 */
export async function creditInvoiceForRefund(
  tx: Tx,
  actor: LedgerActor,
  r: {
    readonly invoiceId: string
    readonly amount: Money
    readonly date: string
    readonly sourceRecordId: string
    readonly reference: string
    readonly clearingAccountId: string
    readonly receivablesAccountId: string
  }
): Promise<{ creditNoteId: string; entryId: string }> {
  const note = await insertCreditNote(tx, actor, {
    invoiceId: r.invoiceId,
    creditNoteDate: r.date,
    reason: "refund",
    notes: `Razorpay refund ${r.reference}`,
    credit: { kind: "refund", amount: r.amount },
    sourceRecordId: r.sourceRecordId,
  })
  const zero = paise(0n)
  const payout = await postEntry(
    actor,
    {
      entryDate: r.date,
      narration: `Razorpay refund ${r.reference} (${note.number})`,
      sourceType: "razorpay",
      sourceId: r.sourceRecordId,
      lines: [
        {
          accountId: r.receivablesAccountId,
          partyId: note.partyId,
          debit: r.amount,
          credit: zero,
          description: note.number,
        },
        {
          accountId: r.clearingAccountId,
          partyId: null,
          debit: zero,
          credit: r.amount,
          description: null,
        },
      ],
    },
    { tx }
  )
  return { creditNoteId: note.id, entryId: payout.id }
}

const noteColumns = {
  id: creditNotes.id,
  number: creditNotes.number,
  financialYear: creditNotes.financialYear,
  invoiceId: creditNotes.invoiceId,
  invoiceNumber: invoices.number,
  partyId: creditNotes.partyId,
  partyName: creditNotes.partyName,
  partyGstin: creditNotes.partyGstin,
  partyAddress: creditNotes.partyAddress,
  partyStateCode: creditNotes.partyStateCode,
  creditNoteDate: creditNotes.creditNoteDate,
  reason: creditNotes.reason,
  placeOfSupply: creditNotes.placeOfSupply,
  supplyType: creditNotes.supplyType,
  reverseCharge: creditNotes.reverseCharge,
  taxable: creditNotes.taxablePaise,
  cgst: creditNotes.cgstPaise,
  sgst: creditNotes.sgstPaise,
  igst: creditNotes.igstPaise,
  roundOff: creditNotes.roundOffPaise,
  total: creditNotes.totalPaise,
  sourceRecordId: creditNotes.sourceRecordId,
  notes: creditNotes.notes,
  journalEntryId: creditNotes.journalEntryId,
  createdAt: creditNotes.createdAt,
}

function baseQuery() {
  return getDb()
    .select(noteColumns)
    .from(creditNotes)
    .innerJoin(
      invoices,
      and(
        eq(invoices.organizationId, creditNotes.organizationId),
        eq(invoices.id, creditNotes.invoiceId)
      )
    )
    .$dynamic()
}

type NoteRow = Awaited<ReturnType<typeof baseQuery>>[number]
export type CreditNoteListItem = Omit<CreditNote, "lines">

function toListItem(r: NoteRow): CreditNoteListItem {
  return {
    id: r.id,
    number: r.number,
    financialYear: r.financialYear,
    invoice: { id: r.invoiceId, number: r.invoiceNumber },
    party: {
      id: r.partyId,
      name: r.partyName,
      gstin: r.partyGstin,
      address: r.partyAddress,
      stateCode: r.partyStateCode,
    },
    creditNoteDate: r.creditNoteDate,
    reason: r.reason,
    placeOfSupply: r.placeOfSupply,
    supplyType: r.supplyType,
    reverseCharge: r.reverseCharge,
    taxable: paise(r.taxable),
    cgst: paise(r.cgst),
    sgst: paise(r.sgst),
    igst: paise(r.igst),
    roundOff: paise(r.roundOff),
    total: paise(r.total),
    sourceRecordId: r.sourceRecordId,
    notes: r.notes,
    journalEntryId: r.journalEntryId,
    createdAt: r.createdAt.toISOString(),
  }
}

/** Returns null when the credit note doesn't exist in this organisation. */
export async function getCreditNote(
  ctx: OrgContext,
  id: string
): Promise<CreditNote | null> {
  assertCan(ctx, "ledger", "read")
  const noteId = parseInput(idSchema, id)
  const [row] = await baseQuery()
    .where(
      and(eq(creditNotes.organizationId, ctx.orgId), eq(creditNotes.id, noteId))
    )
    .limit(1)
  if (!row) return null
  const lines = await getDb()
    .select()
    .from(creditNoteLines)
    .where(
      and(
        eq(creditNoteLines.organizationId, ctx.orgId),
        eq(creditNoteLines.creditNoteId, noteId)
      )
    )
    .orderBy(asc(creditNoteLines.lineNo))
  return {
    ...toListItem(row),
    lines: lines.map((l) => ({
      id: l.id,
      invoiceLineId: l.invoiceLineId,
      description: l.description,
      hsnSac: l.hsnSac,
      quantity:
        l.quantityMilli === 0n ? null : formatQuantityMilli(l.quantityMilli),
      unitPrice: paise(l.unitPricePaise),
      gstRateBps: l.gstRateBps,
      taxable: paise(l.taxablePaise),
      cgst: paise(l.cgstPaise),
      sgst: paise(l.sgstPaise),
      igst: paise(l.igstPaise),
      total: paise(l.totalPaise),
    })),
  }
}

const listCreditNotesFiltersSchema = z.object({
  invoiceId: idSchema.optional(),
})
export type ListCreditNotesFilters = z.input<
  typeof listCreditNotesFiltersSchema
>

/**
 * Newest first (date, then when it was created); optionally only those
 * against one invoice.
 */
export async function listCreditNotes(
  ctx: OrgContext,
  cursor: string | null,
  filters: ListCreditNotesFilters = {},
  options: PageOptions = {}
): Promise<Page<CreditNoteListItem>> {
  assertCan(ctx, "ledger", "read")
  const f = parseInput(listCreditNotesFiltersSchema, filters)
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = decodeCursor(cursor)
  const key = after ? dateTimeCursorKey(after.k) : null
  const rows = await baseQuery()
    .where(
      and(
        eq(creditNotes.organizationId, ctx.orgId),
        f.invoiceId ? eq(creditNotes.invoiceId, f.invoiceId) : undefined,
        after && key
          ? sql`(${creditNotes.creditNoteDate}, ${creditNotes.createdAt}, ${creditNotes.id}) < (${key.date}::date, ${key.at}, ${after.id}::uuid)`
          : undefined
      )
    )
    .orderBy(
      desc(creditNotes.creditNoteDate),
      desc(creditNotes.createdAt),
      desc(creditNotes.id)
    )
    .limit(limit + 1)
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return {
    items: items.map(toListItem),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({
            k: `${last.creditNoteDate}|${last.createdAt.toISOString()}`,
            id: last.id,
          })
        : null,
  }
}
