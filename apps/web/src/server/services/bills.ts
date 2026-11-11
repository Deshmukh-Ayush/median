import "server-only"

import {
  ServiceError,
  adjustVendorAdvanceInputSchema,
  billExtractionSchema,
  idSchema,
  listBillsFiltersSchema,
  pageOptionsSchema,
  parseInput,
  partyStatementInputSchema,
  recordBillPaymentInputSchema,
  recordVendorAdvanceInputSchema,
} from "@workspace/contracts"
import type {
  AdjustVendorAdvanceInput,
  Bill,
  BillStatus,
  ListBillsFilters,
  Page,
  PageOptions,
  PartyStatement,
  PartyStatementInput,
  PayablesAgeing,
  PayablesBuckets,
  RecordBillPaymentInput,
  RecordVendorAdvanceInput,
} from "@workspace/contracts"
import { formatInr, paise } from "@workspace/ledger"
import type { Money, SystemAccountKey } from "@workspace/ledger"
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm"

import { getDb, withTransaction } from "../db"
import type { Tx } from "../db"
import {
  billAllocations,
  bills,
  documents,
  journalEntries,
  journalLines,
  ledgerAccounts,
  parties,
} from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { postEntry } from "./ledger"
import type { LedgerActor } from "./ledger"
import { decodeCursor, encodeCursor } from "./pagination"
import { istDateOf } from "./posting-rules"

/** Due-date fallback when neither the bill nor the vendor says. */
const FALLBACK_TERMS_DAYS = 30
const ZERO = paise(0n)

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function systemAccounts(
  db: Tx | ReturnType<typeof getDb>,
  orgId: string,
  keys: readonly SystemAccountKey[]
): Promise<Record<SystemAccountKey, string | undefined>> {
  const rows = await db
    .select({ id: ledgerAccounts.id, key: ledgerAccounts.systemKey })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.organizationId, orgId),
        inArray(ledgerAccounts.systemKey, [...keys])
      )
    )
  const out: Partial<Record<SystemAccountKey, string>> = {}
  for (const r of rows) if (r.key) out[r.key as SystemAccountKey] = r.id
  return out as Record<SystemAccountKey, string | undefined>
}

function need(id: string | undefined, what: string): string {
  if (!id)
    throw new ServiceError(
      "VALIDATION",
      `The chart of accounts has no ${what} account.`
    )
  return id
}

/**
 * After a vendor bill's inbox item is approved: records the bill (number and
 * dates from the extraction, amount from the entry's credit to trade
 * payables for the vendor). Nothing is recorded when the entry owes the
 * vendor nothing (e.g. paid in cash). Internal: approveInboxItem calls it.
 */
export async function recordApprovedBill(
  tx: Tx,
  orgId: string,
  item: {
    readonly id: string
    readonly documentId: string
    readonly entryId: string
    readonly entryDate: string
    readonly lines: readonly {
      readonly accountId: string
      readonly partyId?: string | null
      readonly credit: bigint
      readonly debit: bigint
    }[]
  }
): Promise<string | null> {
  const { trade_payables: payables } = await systemAccounts(tx, orgId, [
    "trade_payables",
  ])
  const owed = item.lines.filter(
    (l) => l.accountId === payables && l.partyId && l.credit > 0n
  )
  const partyId = owed[0]?.partyId
  const total = owed.reduce((s, l) => s + l.credit - l.debit, 0n)
  if (!partyId || total <= 0n) return null

  const [[doc], [vendor]] = await Promise.all([
    tx
      .select({ extracted: documents.extracted })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, orgId),
          eq(documents.id, item.documentId)
        )
      ),
    tx
      .select({ terms: parties.paymentTermsDays })
      .from(parties)
      .where(and(eq(parties.organizationId, orgId), eq(parties.id, partyId))),
  ])
  const bill = billExtractionSchema.safeParse(doc?.extracted).data
  const billDate = item.entryDate
  const dueDate =
    bill?.dueDate && bill.dueDate >= billDate
      ? bill.dueDate
      : addDays(billDate, vendor?.terms ?? FALLBACK_TERMS_DAYS)
  const [row] = await tx
    .insert(bills)
    .values({
      organizationId: orgId,
      partyId,
      number: (bill?.billNumber ?? "Unnumbered").slice(0, 100),
      billDate,
      dueDate,
      totalPaise: total,
      journalEntryId: item.entryId,
      inboxItemId: item.id,
      documentId: item.documentId,
    })
    .returning({ id: bills.id })
  return row?.id ?? null
}

const billColumns = {
  id: bills.id,
  partyId: bills.partyId,
  partyName: parties.name,
  partyGstin: parties.gstin,
  number: bills.number,
  billDate: bills.billDate,
  dueDate: bills.dueDate,
  total: bills.totalPaise,
  settled: bills.settledPaise,
  journalEntryId: bills.journalEntryId,
  documentId: bills.documentId,
  createdAt: bills.createdAt,
}

function statusOf(total: bigint, settled: bigint): BillStatus {
  if (settled >= total) return "paid"
  return settled > 0n ? "partially_paid" : "open"
}

function toBill(r: {
  id: string
  partyId: string
  partyName: string
  partyGstin: string | null
  number: string
  billDate: string
  dueDate: string
  total: bigint
  settled: bigint
  journalEntryId: string
  documentId: string | null
  createdAt: Date
}): Bill {
  return {
    id: r.id,
    party: { id: r.partyId, name: r.partyName, gstin: r.partyGstin },
    number: r.number,
    billDate: r.billDate,
    dueDate: r.dueDate,
    total: paise(r.total),
    settled: paise(r.settled),
    outstanding: paise(r.total - r.settled),
    status: statusOf(r.total, r.settled),
    journalEntryId: r.journalEntryId,
    documentId: r.documentId,
    createdAt: r.createdAt.toISOString(),
  }
}

const partyJoin = and(
  eq(parties.organizationId, bills.organizationId),
  eq(parties.id, bills.partyId)
)

/** Bills newest first; by default only those with something still owed. */
export async function listBills(
  ctx: OrgContext,
  cursor: string | null,
  filters: ListBillsFilters = {},
  options: PageOptions = {}
): Promise<Page<Bill>> {
  assertCan(ctx, "ledger", "read")
  const f = parseInput(listBillsFiltersSchema, filters)
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = decodeCursor(cursor)
  const rows = await getDb()
    .select(billColumns)
    .from(bills)
    .innerJoin(parties, partyJoin)
    .where(
      and(
        eq(bills.organizationId, ctx.orgId),
        f.partyId ? eq(bills.partyId, f.partyId) : undefined,
        f.status === "all"
          ? undefined
          : sql`${bills.settledPaise} < ${bills.totalPaise}`,
        after
          ? or(
              lt(bills.billDate, after.k),
              and(eq(bills.billDate, after.k), lt(bills.id, after.id))
            )
          : undefined
      )
    )
    .orderBy(desc(bills.billDate), desc(bills.id))
    .limit(limit + 1)
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return {
    items: items.map(toBill),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ k: last.billDate, id: last.id })
        : null,
  }
}

/** The bill, locked for this transaction. */
async function lockBill(tx: Tx, orgId: string, billId: string) {
  const [row] = await tx
    .select({
      id: bills.id,
      partyId: bills.partyId,
      number: bills.number,
      total: bills.totalPaise,
      settled: bills.settledPaise,
    })
    .from(bills)
    .where(and(eq(bills.organizationId, orgId), eq(bills.id, billId)))
    .for("update")
  if (!row) throw new ServiceError("NOT_FOUND", "Bill not found.")
  return row
}

async function allocate(
  tx: Tx,
  orgId: string,
  bill: { id: string; total: bigint; settled: bigint },
  kind: "payment" | "advance",
  entryId: string,
  amount: Money
): Promise<void> {
  await tx.insert(billAllocations).values({
    organizationId: orgId,
    billId: bill.id,
    kind,
    journalEntryId: entryId,
    amountPaise: amount,
  })
  await tx
    .update(bills)
    .set({ settledPaise: bill.settled + amount })
    .where(and(eq(bills.organizationId, orgId), eq(bills.id, bill.id)))
}

function assertWithinOutstanding(
  bill: { number: string; total: bigint; settled: bigint },
  amount: bigint
) {
  const outstanding = bill.total - bill.settled
  if (amount > outstanding)
    throw new ServiceError(
      "VALIDATION",
      `Bill ${bill.number} has ${formatInr(paise(outstanding))} outstanding.`,
      { field: "amount" }
    )
}

async function assertBankAccount(tx: Tx, orgId: string, accountId: string) {
  const [row] = await tx
    .select({ isBank: ledgerAccounts.isBank })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.organizationId, orgId),
        eq(ledgerAccounts.id, accountId)
      )
    )
  if (!row?.isBank)
    throw new ServiceError("VALIDATION", "Choose one of your bank accounts.", {
      field: "bankAccountId",
    })
}

/**
 * A bank debit matched to a bill was posted: record it against the bill in
 * the same transaction. Internal: the bank import calls it.
 */
export async function applyBillPayment(
  tx: Tx,
  orgId: string,
  billId: string,
  entryId: string,
  amount: Money
): Promise<void> {
  const bill = await lockBill(tx, orgId, billId)
  assertWithinOutstanding(bill, amount)
  await allocate(tx, orgId, bill, "payment", entryId, amount)
}

const actorOf = (ctx: OrgContext): LedgerActor => ({
  orgId: ctx.orgId,
  userId: ctx.userId,
  source: "web",
})

/**
 * Pays (part of) a bill: Dr trade payables (vendor) / Cr bank. Throws
 * VALIDATION (more than outstanding, not a bank account), NOT_FOUND,
 * PERIOD_LOCKED.
 */
export async function recordBillPayment(
  ctx: OrgContext,
  input: RecordBillPaymentInput
): Promise<Bill> {
  assertCan(ctx, "ledger", "post")
  const p = parseInput(recordBillPaymentInputSchema, input)
  await withTransaction(async (tx) => {
    const bill = await lockBill(tx, ctx.orgId, p.billId)
    assertWithinOutstanding(bill, p.amount)
    await assertBankAccount(tx, ctx.orgId, p.bankAccountId)
    const a = await systemAccounts(tx, ctx.orgId, ["trade_payables"])
    const entry = await postEntry(
      actorOf(ctx),
      {
        entryDate: p.date,
        narration:
          `Payment for bill ${bill.number}${p.reference ? ` (${p.reference})` : ""}`.slice(
            0,
            500
          ),
        sourceType: "bill",
        sourceId: bill.id,
        lines: [
          {
            accountId: need(a.trade_payables, "trade payables"),
            partyId: bill.partyId,
            debit: p.amount,
            credit: ZERO,
          },
          { accountId: p.bankAccountId, debit: ZERO, credit: p.amount },
        ],
      },
      { tx }
    )
    await allocate(tx, ctx.orgId, bill, "payment", entry.id, p.amount)
  })
  return getBill(ctx, p.billId)
}

/**
 * Money paid to a vendor before their bill: Dr advances to vendors (vendor) /
 * Cr bank. Kept apart from payables until adjusted against a bill.
 */
export async function recordVendorAdvance(
  ctx: OrgContext,
  input: RecordVendorAdvanceInput
): Promise<{ readonly entryId: string }> {
  assertCan(ctx, "ledger", "post")
  const p = parseInput(recordVendorAdvanceInputSchema, input)
  return withTransaction(async (tx) => {
    const [vendor] = await tx
      .select({ kind: parties.kind, name: parties.name })
      .from(parties)
      .where(
        and(eq(parties.organizationId, ctx.orgId), eq(parties.id, p.partyId))
      )
    if (!vendor) throw new ServiceError("NOT_FOUND", "Vendor not found.")
    if (vendor.kind !== "vendor")
      throw new ServiceError("VALIDATION", `${vendor.name} isn't a vendor.`)
    await assertBankAccount(tx, ctx.orgId, p.bankAccountId)
    const a = await systemAccounts(tx, ctx.orgId, ["vendor_advances"])
    const entry = await postEntry(
      actorOf(ctx),
      {
        entryDate: p.date,
        narration:
          `Advance to ${vendor.name}${p.reference ? ` (${p.reference})` : ""}`.slice(
            0,
            500
          ),
        sourceType: "manual",
        lines: [
          {
            accountId: need(a.vendor_advances, "advances to vendors"),
            partyId: p.partyId,
            debit: p.amount,
            credit: ZERO,
          },
          { accountId: p.bankAccountId, debit: ZERO, credit: p.amount },
        ],
      },
      { tx }
    )
    return { entryId: entry.id }
  })
}

/**
 * Settles (part of) a bill from the vendor's advance: Dr trade payables /
 * Cr advances to vendors, both against the vendor. Throws VALIDATION when
 * the advance or the bill's outstanding is smaller than the amount.
 */
export async function adjustVendorAdvance(
  ctx: OrgContext,
  input: AdjustVendorAdvanceInput
): Promise<Bill> {
  assertCan(ctx, "ledger", "post")
  const p = parseInput(adjustVendorAdvanceInputSchema, input)
  await withTransaction(async (tx) => {
    const bill = await lockBill(tx, ctx.orgId, p.billId)
    assertWithinOutstanding(bill, p.amount)
    const a = await systemAccounts(tx, ctx.orgId, [
      "trade_payables",
      "vendor_advances",
    ])
    const advances = need(a.vendor_advances, "advances to vendors")
    const [held] = await tx
      .select({
        balance: sql<string>`coalesce(sum(${journalLines.debitPaise} - ${journalLines.creditPaise}), 0)::text`,
      })
      .from(journalLines)
      .where(
        and(
          eq(journalLines.organizationId, ctx.orgId),
          eq(journalLines.accountId, advances),
          eq(journalLines.partyId, bill.partyId)
        )
      )
    const available = BigInt(held?.balance ?? "0")
    if (p.amount > available)
      throw new ServiceError(
        "VALIDATION",
        `This vendor's advance is ${formatInr(paise(available > 0n ? available : 0n))}.`,
        { field: "amount" }
      )
    const entry = await postEntry(
      actorOf(ctx),
      {
        entryDate: p.date,
        narration: `Advance adjusted against bill ${bill.number}`,
        sourceType: "bill",
        sourceId: bill.id,
        lines: [
          {
            accountId: need(a.trade_payables, "trade payables"),
            partyId: bill.partyId,
            debit: p.amount,
            credit: ZERO,
          },
          {
            accountId: advances,
            partyId: bill.partyId,
            debit: ZERO,
            credit: p.amount,
          },
        ],
      },
      { tx }
    )
    await allocate(tx, ctx.orgId, bill, "advance", entry.id, p.amount)
  })
  return getBill(ctx, p.billId)
}

/** One bill. Throws NOT_FOUND. */
export async function getBill(ctx: OrgContext, id: string): Promise<Bill> {
  assertCan(ctx, "ledger", "read")
  const billId = parseInput(idSchema, id)
  const [row] = await getDb()
    .select(billColumns)
    .from(bills)
    .innerJoin(parties, partyJoin)
    .where(and(eq(bills.organizationId, ctx.orgId), eq(bills.id, billId)))
  if (!row) throw new ServiceError("NOT_FOUND", "Bill not found.")
  return toBill(row)
}

/** Outstanding payables by vendor and age (days since the bill date). */
export async function getPayablesAgeing(
  ctx: OrgContext,
  cursor: string | null,
  options: PageOptions = {}
): Promise<PayablesAgeing> {
  assertCan(ctx, "ledger", "read")
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = decodeCursor(cursor)
  const asOf = istDateOf(new Date())
  const outstanding = sql`(${bills.totalPaise} - ${bills.settledPaise})`
  const age = sql`(${asOf}::date - ${bills.billDate})`
  const bucket = (cond: ReturnType<typeof sql>) =>
    sql<string>`coalesce(sum(${outstanding}) filter (where ${cond}), 0)::text`
  const buckets = {
    days0To30: bucket(sql`${age} <= 30`),
    days31To45: bucket(sql`${age} between 31 and 45`),
    days46To60: bucket(sql`${age} between 46 and 60`),
    days61To90: bucket(sql`${age} between 61 and 90`),
    over90: bucket(sql`${age} > 90`),
    total: sql<string>`coalesce(sum(${outstanding}), 0)::text`,
  }
  const open = and(eq(bills.organizationId, ctx.orgId), sql`${outstanding} > 0`)
  const db = getDb()
  const [totalsRows, msmeRows, partyRows] = await db.batch([
    db.select(buckets).from(bills).where(open),
    db
      .select({ amount: bucket(sql`${age} > 45`) })
      .from(bills)
      .innerJoin(parties, partyJoin)
      .where(and(open, inArray(parties.msmeCategory, ["micro", "small"]))),
    db
      .select({
        partyId: parties.id,
        name: parties.name,
        gstin: parties.gstin,
        msmeCategory: parties.msmeCategory,
        openBills: sql<number>`count(*)::int`,
        ...buckets,
      })
      .from(bills)
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
      .groupBy(parties.id, parties.name, parties.gstin, parties.msmeCategory)
      .orderBy(asc(parties.name), asc(parties.id))
      .limit(limit + 1),
  ])
  const toBuckets = (
    r: Record<keyof PayablesBuckets, string> | undefined
  ): PayablesBuckets => ({
    days0To30: paise(BigInt(r?.days0To30 ?? "0")),
    days31To45: paise(BigInt(r?.days31To45 ?? "0")),
    days46To60: paise(BigInt(r?.days46To60 ?? "0")),
    days61To90: paise(BigInt(r?.days61To90 ?? "0")),
    over90: paise(BigInt(r?.over90 ?? "0")),
    total: paise(BigInt(r?.total ?? "0")),
  })
  const page = partyRows.slice(0, limit)
  const last = page.at(-1)
  return {
    asOf,
    totals: toBuckets(totalsRows[0]),
    msmeOver45Days: paise(BigInt(msmeRows[0]?.amount ?? "0")),
    parties: {
      items: page.map((r) => ({
        party: { id: r.partyId, name: r.name, gstin: r.gstin },
        openBills: r.openBills,
        msmeCategory: r.msmeCategory,
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
 * A customer's or vendor's statement of account: every ledger line with the
 * party between `from` and `to`, with opening, running and closing balances
 * (debit − credit). Keyset-paged; each page opens where the last closed.
 */
export async function getPartyStatement(
  ctx: OrgContext,
  partyId: string,
  range: PartyStatementInput,
  cursor: string | null = null,
  options: PageOptions = {}
): Promise<PartyStatement> {
  assertCan(ctx, "ledger", "read")
  const id = parseInput(idSchema, partyId)
  const r = parseInput(partyStatementInputSchema, range)
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = decodeCursor(cursor)
  // The cursor's id is "<entry id>:<line no>"; k is the entry date.
  const [afterEntry, afterLine] = after ? after.id.split(":") : []
  const position = sql`(${journalLines.entryDate}, ${journalLines.entryId}, ${journalLines.lineNo})`
  const afterTuple =
    after && afterEntry && afterLine
      ? sql`(${after.k}::date, ${afterEntry}::uuid, ${Number(afterLine)}::int)`
      : null
  const mine = and(
    eq(journalLines.organizationId, ctx.orgId),
    eq(journalLines.partyId, id)
  )
  const db = getDb()
  const [partyRows, openingRows, rows] = await db.batch([
    db
      .select({ id: parties.id, name: parties.name, gstin: parties.gstin })
      .from(parties)
      .where(and(eq(parties.organizationId, ctx.orgId), eq(parties.id, id))),
    db
      .select({
        balance: sql<string>`coalesce(sum(${journalLines.debitPaise} - ${journalLines.creditPaise}), 0)::text`,
      })
      .from(journalLines)
      .where(
        and(
          mine,
          afterTuple
            ? sql`(${journalLines.entryDate} < ${r.from} or (${journalLines.entryDate} >= ${r.from} and ${position} <= ${afterTuple}))`
            : lt(journalLines.entryDate, r.from)
        )
      ),
    db
      .select({
        date: journalLines.entryDate,
        entryId: journalLines.entryId,
        lineNo: journalLines.lineNo,
        narration: journalEntries.narration,
        code: ledgerAccounts.code,
        accountName: ledgerAccounts.name,
        debit: journalLines.debitPaise,
        credit: journalLines.creditPaise,
      })
      .from(journalLines)
      .innerJoin(
        journalEntries,
        and(
          eq(journalEntries.organizationId, journalLines.organizationId),
          eq(journalEntries.id, journalLines.entryId)
        )
      )
      .innerJoin(
        ledgerAccounts,
        and(
          eq(ledgerAccounts.organizationId, journalLines.organizationId),
          eq(ledgerAccounts.id, journalLines.accountId)
        )
      )
      .where(
        and(
          mine,
          sql`${journalLines.entryDate} between ${r.from} and ${r.to}`,
          afterTuple ? sql`${position} > ${afterTuple}` : undefined
        )
      )
      .orderBy(
        asc(journalLines.entryDate),
        asc(journalLines.entryId),
        asc(journalLines.lineNo)
      )
      .limit(limit + 1),
  ])
  const party = partyRows[0]
  if (!party)
    throw new ServiceError("NOT_FOUND", "Customer or vendor not found.")
  const opening = BigInt(openingRows[0]?.balance ?? "0")
  let balance = opening
  const page = rows.slice(0, limit)
  const lines = page.map((l) => {
    balance += l.debit - l.credit
    return {
      date: l.date,
      entryId: l.entryId,
      narration: l.narration,
      account: { code: l.code, name: l.accountName },
      debit: paise(l.debit),
      credit: paise(l.credit),
      balance: paise(balance),
    }
  })
  const last = page.at(-1)
  return {
    party,
    from: r.from,
    to: r.to,
    opening: paise(opening),
    lines,
    closing: paise(balance),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ k: last.date, id: `${last.entryId}:${last.lineNo}` })
        : null,
  }
}
