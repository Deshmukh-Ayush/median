import "server-only"

import { ServiceError, isoDateSchema, parseInput } from "@workspace/contracts"
import type { IsoDate, TallyExport } from "@workspace/contracts"
import { financialYearStart } from "@workspace/ledger"
import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm"
import { z } from "zod"

import { getDb } from "../db"
import {
  journalEntries,
  journalLines,
  ledgerAccounts,
  parties,
} from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import {
  mastersXml,
  tallyGroupOf,
  uniqueNames,
  voucherTypeOf,
  vouchersXml,
} from "./tally-export"
import type { ExportLedger, ExportVoucher } from "./tally-export"

const rangeSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((r) => r.from <= r.to, "'from' is after 'to'")

/** Lines in one export; above this, export a shorter range. */
const MAX_LINES = 100_000

/**
 * Tally-importable XML for a date range: a masters file (every account,
 * plus a ledger per customer and vendor, with opening balances as of
 * `from`) and a vouchers file (every entry in the range). Import masters
 * first. Opening balances of income and expense ledgers run from the start
 * of the financial year; earlier years' profit opens in Retained earnings,
 * so Tally's trial balance equals Median's.
 */
export async function exportTally(
  ctx: OrgContext,
  from: IsoDate,
  to: IsoDate
): Promise<TallyExport> {
  assertCan(ctx, "report", "export")
  const r = parseInput(rangeSchema, { from, to })
  const fyStart = financialYearStart(r.from)
  const db = getDb()
  const net = sql<string>`sum(${journalLines.debitPaise} - ${journalLines.creditPaise})::text`

  const [accounts, partyRows, before, priorProfit, lineCount] = await db.batch([
    db
      .select({
        id: ledgerAccounts.id,
        code: ledgerAccounts.code,
        name: ledgerAccounts.name,
        type: ledgerAccounts.type,
        systemKey: ledgerAccounts.systemKey,
        isBank: ledgerAccounts.isBank,
      })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.organizationId, ctx.orgId))
      .orderBy(asc(ledgerAccounts.code)),
    db
      .select({
        id: parties.id,
        kind: parties.kind,
        name: parties.name,
        gstin: parties.gstin,
      })
      .from(parties)
      .where(eq(parties.organizationId, ctx.orgId))
      .orderBy(asc(parties.name), asc(parties.id)),
    db
      .select({
        accountId: journalLines.accountId,
        partyId: journalLines.partyId,
        net,
      })
      .from(journalLines)
      .where(
        and(
          eq(journalLines.organizationId, ctx.orgId),
          lt(journalLines.entryDate, r.from)
        )
      )
      .groupBy(journalLines.accountId, journalLines.partyId),
    db
      .select({ accountId: journalLines.accountId, net })
      .from(journalLines)
      .innerJoin(
        ledgerAccounts,
        and(
          eq(ledgerAccounts.organizationId, journalLines.organizationId),
          eq(ledgerAccounts.id, journalLines.accountId),
          inArray(ledgerAccounts.type, ["income", "expense"])
        )
      )
      .where(
        and(
          eq(journalLines.organizationId, ctx.orgId),
          lt(journalLines.entryDate, fyStart)
        )
      )
      .groupBy(journalLines.accountId),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(journalLines)
      .where(
        and(
          eq(journalLines.organizationId, ctx.orgId),
          gte(journalLines.entryDate, r.from),
          lte(journalLines.entryDate, r.to)
        )
      ),
  ])
  if ((lineCount[0]?.n ?? 0) > MAX_LINES)
    throw new ServiceError(
      "VALIDATION",
      "That range has too many entries for one file; export a shorter range."
    )

  const lines = await db
    .select({
      entryId: journalEntries.id,
      entryDate: journalEntries.entryDate,
      narration: journalEntries.narration,
      sourceType: journalEntries.sourceType,
      accountId: journalLines.accountId,
      partyId: journalLines.partyId,
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
    .where(
      and(
        eq(journalLines.organizationId, ctx.orgId),
        gte(journalLines.entryDate, r.from),
        lte(journalLines.entryDate, r.to)
      )
    )
    .orderBy(
      asc(journalLines.entryDate),
      asc(journalLines.entryId),
      asc(journalLines.lineNo)
    )

  // Ledger names: accounts first, then parties; unique as Tally needs.
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const partyById = new Map(partyRows.map((p) => [p.id, p]))
  const names = uniqueNames([
    ...accounts.map((a) => a.name),
    ...partyRows.map((p) => p.name),
  ])
  const accountName = new Map(
    accounts.map((a, i) => [a.id, names[i] ?? a.name])
  )
  const partyName = new Map(
    partyRows.map((p, i) => [p.id, names[accounts.length + i] ?? p.name])
  )
  const isPartyAccount = (id: string) => {
    const key = accountById.get(id)?.systemKey
    return key === "trade_receivables" || key === "trade_payables"
  }
  const ledgerOf = (accountId: string, partyId: string | null) =>
    partyId && isPartyAccount(accountId)
      ? (partyName.get(partyId) ?? "")
      : (accountName.get(accountId) ?? "")

  const opening = new Map<string, bigint>()
  const bump = (ledger: string, v: bigint) =>
    opening.set(ledger, (opening.get(ledger) ?? 0n) + v)
  for (const b of before) bump(ledgerOf(b.accountId, b.partyId), BigInt(b.net))
  const retained = accounts.find((a) => a.systemKey === "retained_earnings")
  for (const p of priorProfit) {
    const v = BigInt(p.net)
    bump(accountName.get(p.accountId) ?? "", -v)
    if (retained) bump(accountName.get(retained.id) ?? "", v)
  }

  const usedParties = new Set([
    ...before.flatMap((b) =>
      b.partyId && isPartyAccount(b.accountId) ? [b.partyId] : []
    ),
    ...lines.flatMap((l) =>
      l.partyId && isPartyAccount(l.accountId) ? [l.partyId] : []
    ),
  ])
  // Receivables and payables live in the party ledgers; the control
  // ledgers only go out if something is booked on them without a party.
  const controlUsed = new Set([
    ...before.flatMap((b) =>
      !b.partyId && BigInt(b.net) !== 0n ? [b.accountId] : []
    ),
    ...lines.flatMap((l) => (l.partyId ? [] : [l.accountId])),
  ])
  const ledgers: ExportLedger[] = [
    ...accounts
      .filter((a) => !isPartyAccount(a.id) || controlUsed.has(a.id))
      .map((a) => ({
        name: accountName.get(a.id) ?? a.name,
        group: tallyGroupOf(a),
        openingPaise: opening.get(accountName.get(a.id) ?? "") ?? 0n,
        gstin: null,
      })),
    ...[...usedParties].flatMap((id) => {
      const p = partyById.get(id)
      if (!p) return []
      const name = partyName.get(id) ?? p.name
      return [
        {
          name,
          group: p.kind === "customer" ? "Sundry Debtors" : "Sundry Creditors",
          openingPaise: opening.get(name) ?? 0n,
          gstin: p.gstin,
        },
      ]
    }),
  ]

  const vouchers: ExportVoucher[] = []
  let i = 0
  while (i < lines.length) {
    const first = lines[i]
    if (!first) break
    const own: typeof lines = []
    while (i < lines.length && lines[i]?.entryId === first.entryId)
      own.push(lines[i++]!)
    const vLines = own.map((l) => ({
      ledger: ledgerOf(l.accountId, l.partyId),
      debitPaise: l.debit - l.credit,
    }))
    vouchers.push({
      guid: `median-${first.entryId}`,
      date: first.entryDate,
      type: voucherTypeOf(
        first.sourceType,
        own.map((l) => {
          const a = accountById.get(l.accountId)
          return {
            debitPaise: l.debit - l.credit,
            cashOrBank: !!a && (a.isBank || /^110\d$/.test(a.code)),
          }
        })
      ),
      number: `MED-${first.entryId.slice(0, 8)}`,
      narration: first.narration,
      lines: vLines,
    })
  }

  return {
    from: r.from,
    to: r.to,
    files: [
      {
        fileName: `median-tally-masters-${r.from}.xml`,
        xml: mastersXml(ledgers),
      },
      {
        fileName: `median-tally-vouchers-${r.from}-to-${r.to}.xml`,
        xml: vouchersXml(vouchers),
      },
    ],
    ledgerCount: ledgers.length,
    voucherCount: vouchers.length,
  }
}
