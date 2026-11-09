import "server-only"

import {
  ServiceError,
  isoDateSchema,
  pageOptionsSchema,
  parseInput,
} from "@workspace/contracts"
import type {
  CashAccountPosition,
  CashPosition,
  IsoDate,
  PageOptions,
  RevenueBreakdown,
} from "@workspace/contracts"
import { classifyAccount, naturalBalance, paise } from "@workspace/ledger"
import { and, eq, like, lt, or, sql } from "drizzle-orm"
import { z } from "zod"

import { getDb } from "../db"
import { connections, ledgerAccounts, sourceRecords } from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { decodeCursor, encodeCursor } from "./pagination"
import { accountTotalsQuery, toAccountTotals } from "./reports"

const rangeSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((r) => r.from <= r.to, "'from' is after 'to'")

const customerRow = z.object({
  party_id: z.string(),
  name: z.string(),
  gstin: z.string().nullable(),
  invoices: z.coerce.number(),
  revenue: z.string(),
})

/**
 * Revenue from operations for a date range: the total as booked, by income
 * account (stream), and by customer from invoices less credit notes
 * (taxable value, excluding GST), highest first and paged. What no
 * customer explains (payments without an invoice, manual entries) is
 * `withoutCustomer`.
 */
export async function getRevenueBreakdown(
  ctx: OrgContext,
  from: IsoDate,
  to: IsoDate,
  cursor: string | null = null,
  options: PageOptions = {}
): Promise<RevenueBreakdown> {
  assertCan(ctx, "report", "read")
  const r = parseInput(rangeSchema, { from, to })
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = decodeCursor(cursor)
  if (
    after &&
    (!/^-?\d+$/.test(after.k) || !z.uuid().safeParse(after.id).success)
  )
    throw new ServiceError("VALIDATION", "Invalid page cursor.")

  // Invoices (not cancelled) and credit notes in the range, per customer.
  const perCustomer = sql`
    select d.party_id, sum(d.taxable) as revenue, sum(d.invoices) as invoices
    from (
      select party_id, taxable_paise as taxable, 1 as invoices from invoices
      where organization_id = ${ctx.orgId} and status <> 'cancelled'
        and invoice_date between ${r.from} and ${r.to}
      union all
      select party_id, -taxable_paise, 0 from credit_notes
      where organization_id = ${ctx.orgId}
        and credit_note_date between ${r.from} and ${r.to}
    ) d group by d.party_id`
  const db = getDb()
  const [streams, page, all] = await db.batch([
    accountTotalsQuery(ctx.orgId, r, ["income"]),
    db.execute(sql`
      with c as (${perCustomer})
      select c.party_id, p.name, p.gstin, c.invoices::int as invoices, c.revenue::text as revenue
      from c join parties p on p.organization_id = ${ctx.orgId} and p.id = c.party_id
      where ${after ? sql`(c.revenue, c.party_id) < (${after.k}::bigint, ${after.id}::uuid)` : sql`true`}
      order by c.revenue desc, c.party_id desc
      limit ${limit + 1}`),
    db.execute(
      sql`with c as (${perCustomer}) select coalesce(sum(revenue), 0)::text as total from c`
    ),
  ])

  const revenue = toAccountTotals(streams).filter(
    (a) => classifyAccount(a.code, a.type).section === "revenue_from_operations"
  )
  const total = revenue.reduce((s, a) => s + naturalBalance(a), 0n)
  const rows = z.array(customerRow).parse(page.rows)
  const shown = rows.slice(0, limit)
  const last = shown.at(-1)
  const customersTotal = BigInt(
    z.object({ total: z.string() }).parse(all.rows[0] ?? { total: "0" }).total
  )
  return {
    from: r.from,
    to: r.to,
    total: paise(total),
    byCustomer: shown.map((c) => ({
      party: { id: c.party_id, name: c.name, gstin: c.gstin },
      invoiceCount: c.invoices,
      revenue: paise(BigInt(c.revenue)),
    })),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ k: last.revenue, id: last.party_id })
        : null,
    withoutCustomer: paise(total - customersTotal),
    byStream: revenue
      .map((a) => ({
        accountId: a.accountId,
        code: a.code,
        name: a.name,
        revenue: naturalBalance(a),
      }))
      .filter((s) => s.revenue !== 0n)
      .sort((a, b) => (a.code < b.code ? -1 : 1)),
  }
}

const istDayAfter = (date: string) =>
  new Date(new Date(`${date}T00:00:00+05:30`).getTime() + 86_400_000)
const istDate = (at: Date) =>
  new Date(at.getTime() + 19_800_000).toISOString().slice(0, 10)

/**
 * Cash as of a date: every bank account, Razorpay clearing and cash in
 * hand with its book balance, the last statement line (or settlement)
 * imported, and how many statement lines are matched vs waiting in the
 * inbox. One batch; the list is the org's cash accounts, so it's short.
 */
export async function getCashPosition(
  ctx: OrgContext,
  asOf: IsoDate
): Promise<CashPosition> {
  assertCan(ctx, "report", "read")
  const date = parseInput(isoDateSchema, asOf)
  const before = istDayAfter(date)
  const db = getDb()
  const signed = sql`case when ${sourceRecords.direction} = 'inflow' then ${sourceRecords.amountPaise} else -${sourceRecords.amountPaise} end`
  const stats = {
    last: sql<Date | null>`max(${sourceRecords.occurredAt})`,
    matchedCount: sql<number>`count(*) filter (where ${sourceRecords.status} = 'posted')::int`,
    matchedAmount: sql<string>`coalesce(sum(${signed}) filter (where ${sourceRecords.status} = 'posted'), 0)::text`,
    unmatchedCount: sql<number>`count(*) filter (where ${sourceRecords.status} = 'inbox')::int`,
    unmatchedAmount: sql<string>`coalesce(sum(${signed}) filter (where ${sourceRecords.status} = 'inbox'), 0)::text`,
    synced: sql<Date | null>`max(${connections.lastSyncedAt})`,
  }
  const [accounts, totals, bankStats, razorpayStats] = await db.batch([
    db
      .select({
        id: ledgerAccounts.id,
        code: ledgerAccounts.code,
        name: ledgerAccounts.name,
        type: ledgerAccounts.type,
        systemKey: ledgerAccounts.systemKey,
        isBank: ledgerAccounts.isBank,
        bankName: ledgerAccounts.bankName,
        accountLast4: ledgerAccounts.accountLast4,
      })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.organizationId, ctx.orgId),
          or(
            eq(ledgerAccounts.isBank, true),
            eq(ledgerAccounts.systemKey, "razorpay_clearing"),
            like(ledgerAccounts.code, "110_")
          )
        )
      )
      .orderBy(ledgerAccounts.code),
    accountTotalsQuery(ctx.orgId, { from: null, to: date }, ["asset"]),
    db
      .select({ accountId: connections.ledgerAccountId, ...stats })
      .from(sourceRecords)
      .innerJoin(
        connections,
        and(
          eq(connections.organizationId, sourceRecords.organizationId),
          eq(connections.id, sourceRecords.connectionId)
        )
      )
      .where(
        and(
          eq(sourceRecords.organizationId, ctx.orgId),
          eq(sourceRecords.kind, "bank_line"),
          lt(sourceRecords.occurredAt, before)
        )
      )
      .groupBy(connections.ledgerAccountId),
    db
      .select(stats)
      .from(sourceRecords)
      .innerJoin(
        connections,
        and(
          eq(connections.organizationId, sourceRecords.organizationId),
          eq(connections.id, sourceRecords.connectionId)
        )
      )
      .where(
        and(
          eq(sourceRecords.organizationId, ctx.orgId),
          eq(sourceRecords.kind, "settlement"),
          lt(sourceRecords.occurredAt, before)
        )
      ),
  ])

  const balance = new Map(
    toAccountTotals(totals).map((t) => [t.accountId, naturalBalance(t)])
  )
  const byBank = new Map(bankStats.map((s) => [s.accountId, s]))
  const toStats = (
    s: (typeof bankStats)[number] | (typeof razorpayStats)[number] | undefined
  ) => ({
    lastStatementDate: s?.last ? istDate(new Date(s.last)) : null,
    lastSyncedAt: s?.synced ? new Date(s.synced).toISOString() : null,
    matched: {
      count: s?.matchedCount ?? 0,
      amount: paise(BigInt(s?.matchedAmount ?? "0")),
    },
    unmatched: {
      count: s?.unmatchedCount ?? 0,
      amount: paise(BigInt(s?.unmatchedAmount ?? "0")),
    },
  })
  const out: CashAccountPosition[] = accounts
    .filter(
      (a) =>
        a.type === "asset" &&
        (a.isBank ||
          a.systemKey === "razorpay_clearing" ||
          classifyAccount(a.code, a.type).lineItem ===
            "cash_and_cash_equivalents")
    )
    .map((a) => {
      const kind = a.isBank
        ? "bank"
        : a.systemKey === "razorpay_clearing"
          ? "razorpay"
          : "cash"
      const s =
        kind === "bank"
          ? byBank.get(a.id)
          : kind === "razorpay"
            ? razorpayStats[0]
            : undefined
      return {
        accountId: a.id,
        code: a.code,
        name: a.name,
        kind,
        bankName: a.bankName,
        accountLast4: a.accountLast4,
        balance: paise(balance.get(a.id) ?? 0n),
        ...toStats(s),
      }
    })
  return {
    asOf: date,
    total: paise(out.reduce((s, a) => s + a.balance, 0n)),
    accounts: out,
  }
}
