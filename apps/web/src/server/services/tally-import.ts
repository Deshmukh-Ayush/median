import "server-only"

import { ServiceError, gstinCheckCharOk } from "@workspace/contracts"
import type { TallyImportReport } from "@workspace/contracts"
import { formatInr, paise } from "@workspace/ledger"
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { z } from "zod"

import { getDb, withTransaction } from "../db"
import {
  auditLog,
  journalLines,
  ledgerAccounts,
  parties,
  sourceRecords,
} from "../db/schema"
import { planMapping } from "../integrations/tally-import/mapping"
import type { LedgerTarget } from "../integrations/tally-import/mapping"
import { closingBalances } from "../integrations/tally-import/tally"
import type { TallyLedger } from "../integrations/tally-import/tally"
import type { OrgContext } from "./context"
import { postEntry } from "./ledger"
import { insertParty } from "./parties"

// Posts what a Tally import stored: creates the accounts and parties the
// mapping plans, posts one opening-balance entry and one entry per voucher,
// then checks that what Median booked from this connection equals the
// closing balances the Tally file implies, ledger by ledger.

const ledgerPayload = z.object({
  name: z.string(),
  parent: z.string(),
  nature: z.string().nullable(),
  gstin: z.string().nullable(),
})
const openingPayload = z.object({ ledger: z.string(), debitPaise: z.string() })
const voucherPayload = z.object({
  date: z.string(),
  type: z.string(),
  number: z.string(),
  narration: z.string(),
  lines: z.array(z.object({ ledger: z.string(), debitPaise: z.string() })),
})

const SOURCE = "tally_import"

/** Account and party a ledger's lines post to, once targets exist. */
interface Resolved {
  readonly accountId: string
  readonly partyId: string | null
}

export async function postTallyImport(
  ctx: OrgContext,
  connectionId: string
): Promise<TallyImportReport & { posted: number }> {
  const db = getDb()
  const [records, accounts, partyRows] = await db.batch([
    db
      .select({
        id: sourceRecords.id,
        kind: sourceRecords.kind,
        status: sourceRecords.status,
        journalEntryId: sourceRecords.journalEntryId,
        occurredAt: sourceRecords.occurredAt,
        payload: sourceRecords.payload,
      })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.organizationId, ctx.orgId),
          eq(sourceRecords.connectionId, connectionId)
        )
      )
      .orderBy(asc(sourceRecords.occurredAt), asc(sourceRecords.createdAt)),
    db
      .select({
        id: ledgerAccounts.id,
        code: ledgerAccounts.code,
        name: ledgerAccounts.name,
        type: ledgerAccounts.type,
        systemKey: ledgerAccounts.systemKey,
      })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.organizationId, ctx.orgId)),
    db
      .select({
        id: parties.id,
        kind: parties.kind,
        name: parties.name,
        gstin: parties.gstin,
      })
      .from(parties)
      .where(eq(parties.organizationId, ctx.orgId)),
  ])

  // Every ledger this connection knows: masters, then any only vouchers name.
  const ledgers: TallyLedger[] = []
  const openings: {
    recordId: string
    status: string
    ledger: string
    debit: bigint
  }[] = []
  const vouchers: {
    recordId: string
    status: string
    v: z.infer<typeof voucherPayload>
  }[] = []
  for (const r of records) {
    if (r.kind === "account" || r.kind === "party") {
      const p = ledgerPayload.parse(r.payload)
      ledgers.push({
        name: p.name,
        parent: p.parent,
        nature: p.nature as TallyLedger["nature"],
        openingPaise: 0n,
        gstin: p.gstin,
      })
    } else if (r.kind === "opening_balance") {
      const p = openingPayload.parse(r.payload)
      openings.push({
        recordId: r.id,
        status: r.status,
        ledger: p.ledger,
        debit: BigInt(p.debitPaise),
      })
    } else if (r.kind === "voucher") {
      vouchers.push({
        recordId: r.id,
        status: r.status,
        v: voucherPayload.parse(r.payload),
      })
    }
  }
  const known = new Set(ledgers.map((l) => l.name))
  for (const { v } of vouchers)
    for (const l of v.lines)
      if (!known.has(l.ledger)) {
        known.add(l.ledger)
        ledgers.push({
          name: l.ledger,
          parent: "",
          nature: null,
          openingPaise: 0n,
          gstin: null,
        })
      }
  for (const o of openings)
    if (!known.has(o.ledger)) {
      known.add(o.ledger)
      ledgers.push({
        name: o.ledger,
        parent: "",
        nature: null,
        openingPaise: 0n,
        gstin: null,
      })
    }

  const plan = planMapping(ledgers, accounts)
  const resolved = await createTargets(ctx, plan.targets, partyRows)
  const actor = { orgId: ctx.orgId, userId: ctx.userId, source: SOURCE }
  const errors: string[] = [...plan.warnings]
  let posted = 0

  const lineFor = (ledger: string, debit: bigint) => {
    const t = resolved.get(ledger)
    if (!t) throw new Error(`No target for Tally ledger ${ledger}`)
    return {
      accountId: t.accountId,
      partyId: t.partyId,
      debit: paise(debit > 0n ? debit : 0n),
      credit: paise(debit < 0n ? -debit : 0n),
      description: ledger,
    }
  }
  const markPosted = (ids: readonly string[], entryId: string) =>
    getDb()
      .update(sourceRecords)
      .set({ status: "posted", journalEntryId: entryId })
      .where(
        and(
          eq(sourceRecords.organizationId, ctx.orgId),
          inArray(sourceRecords.id, [...ids])
        )
      )

  // One opening entry for every new opening balance; Tally's "difference in
  // opening balances" goes to Opening balance equity.
  const newOpenings = openings.filter((o) => o.status === "new")
  if (newOpenings.length > 0) {
    const firstVoucher = vouchers.map((x) => x.v.date).sort()[0]
    const date = firstVoucher ?? new Date().toISOString().slice(0, 10)
    const lines = newOpenings.map((o) => lineFor(o.ledger, o.debit))
    const diff = newOpenings.reduce((s, o) => s + o.debit, 0n)
    const equity = accounts.find(
      (a) => a.systemKey === "opening_balance_equity"
    )
    if (diff !== 0n && equity) {
      lines.push({
        accountId: equity.id,
        partyId: null,
        debit: paise(diff < 0n ? -diff : 0n),
        credit: paise(diff > 0n ? diff : 0n),
        description: "Difference in opening balances (Tally)",
      })
      errors.push(
        `Tally's opening balances differ by ${formatInr(paise(diff < 0n ? -diff : diff))}; booked to Opening balance equity.`
      )
    }
    try {
      const entry = await postEntry(actor, {
        entryDate: date,
        narration: "Opening balances imported from Tally",
        sourceType: "opening_balance",
        sourceId: `tally:${connectionId}`,
        lines,
      })
      await markPosted(
        newOpenings.map((o) => o.recordId),
        entry.id
      )
      posted += newOpenings.length
    } catch (e) {
      if (!(e instanceof ServiceError)) throw e
      errors.push(`Opening balances on ${date}: ${e.message}`)
    }
  }

  for (const { recordId, status, v } of vouchers) {
    if (status !== "new") continue
    const label = `${v.type} ${v.number}`.trim()
    try {
      const entry = await postEntry(actor, {
        entryDate: v.date,
        narration:
          `Tally ${label}${v.narration ? `: ${v.narration}` : ""}`.slice(
            0,
            500
          ),
        sourceType: "manual",
        sourceId: `tally:${recordId}`,
        lines: v.lines.map((l) => lineFor(l.ledger, BigInt(l.debitPaise))),
      })
      await markPosted([recordId], entry.id)
      posted++
    } catch (e) {
      if (!(e instanceof ServiceError)) throw e
      errors.push(`${label} on ${v.date}: ${e.message}`)
    }
  }

  const check = await trialBalanceCheck(
    ctx.orgId,
    connectionId,
    resolved,
    openings,
    vouchers
  )
  return { posted, ...check, warnings: errors }
}

/** Creates planned accounts and parties (with audit rows); returns every ledger's target. */
async function createTargets(
  ctx: OrgContext,
  targets: ReadonlyMap<string, LedgerTarget>,
  existingParties: readonly {
    id: string
    kind: string
    name: string
    gstin: string | null
  }[]
): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>()
  const norm = (s: string) => s.trim().toLowerCase()
  await withTransaction(async (tx) => {
    for (const [ledger, t] of targets) {
      if (t.kind === "account") {
        out.set(ledger, { accountId: t.accountId, partyId: null })
      } else if (t.kind === "party") {
        const found = existingParties.find(
          (p) =>
            p.kind === t.partyKind &&
            ((t.gstin && p.gstin === t.gstin) || norm(p.name) === norm(t.name))
        )
        const id =
          found?.id ??
          (
            await insertParty(
              tx,
              { orgId: ctx.orgId, userId: ctx.userId, source: SOURCE },
              {
                kind: t.partyKind,
                name: t.name.slice(0, 200),
                // A GSTIN with a typo is left off rather than failing the import.
                ...(t.gstin && gstinCheckCharOk(t.gstin)
                  ? { gstin: t.gstin }
                  : {}),
              }
            )
          ).id
        out.set(ledger, { accountId: t.accountId, partyId: id })
      } else {
        const [row] = await tx
          .insert(ledgerAccounts)
          .values({
            organizationId: ctx.orgId,
            code: t.code,
            name: t.name.slice(0, 200),
            type: t.type,
            isBank: t.isBank,
          })
          .returning({ id: ledgerAccounts.id })
        if (!row)
          throw new ServiceError(
            "CONFLICT",
            `Couldn't create the account ${t.name}.`
          )
        await tx.insert(auditLog).values({
          organizationId: ctx.orgId,
          actorId: ctx.userId,
          action: "account.create",
          entity: "ledger_account",
          entityId: row.id,
          before: null,
          after: { code: t.code, name: t.name, type: t.type, from: "tally" },
          source: SOURCE,
        })
        out.set(ledger, { accountId: row.id, partyId: null })
      }
    }
  })
  return out
}

/**
 * Compares, per (account, party), what Median booked from this connection
 * with what the Tally file implies (opening + vouchers). Records that
 * couldn't post show up here as differences.
 */
async function trialBalanceCheck(
  orgId: string,
  connectionId: string,
  resolved: ReadonlyMap<string, Resolved>,
  openings: readonly { ledger: string; debit: bigint }[],
  vouchers: readonly { v: z.infer<typeof voucherPayload> }[]
): Promise<Omit<TallyImportReport, "warnings">> {
  const expectedByLedger = closingBalances(
    openings.map((o) => ({ name: o.ledger, openingPaise: o.debit })),
    vouchers.map(({ v }) => ({
      lines: v.lines.map((l) => ({
        ledger: l.ledger,
        amountPaise: BigInt(l.debitPaise),
      })),
    }))
  )
  const key = (r: Resolved) => `${r.accountId}:${r.partyId ?? ""}`
  const expected = new Map<string, { ledgers: string[]; amount: bigint }>()
  for (const [ledger, amount] of expectedByLedger) {
    const r = resolved.get(ledger)
    if (!r) continue
    const e = expected.get(key(r)) ?? { ledgers: [], amount: 0n }
    e.ledgers.push(ledger)
    e.amount += amount
    expected.set(key(r), e)
  }

  const db = getDb()
  const entryIds = db
    .selectDistinct({ id: sourceRecords.journalEntryId })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.organizationId, orgId),
        eq(sourceRecords.connectionId, connectionId),
        isNotNull(sourceRecords.journalEntryId)
      )
    )
  const booked = await db
    .select({
      accountId: journalLines.accountId,
      partyId: journalLines.partyId,
      net: sql<string>`sum(${journalLines.debitPaise} - ${journalLines.creditPaise})::text`,
    })
    .from(journalLines)
    .where(
      and(
        eq(journalLines.organizationId, orgId),
        inArray(journalLines.entryId, entryIds)
      )
    )
    .groupBy(journalLines.accountId, journalLines.partyId)
  const actual = new Map(
    booked.map((b) => [`${b.accountId}:${b.partyId ?? ""}`, BigInt(b.net)])
  )

  const differences: TallyImportReport["differences"][number][] = []
  for (const k of new Set([...expected.keys(), ...actual.keys()])) {
    const want = expected.get(k)?.amount ?? 0n
    const got = actual.get(k) ?? 0n
    if (want === got) continue
    differences.push({
      ledgers: expected.get(k)?.ledgers ?? ["Opening balance equity"],
      accountId: k.split(":")[0] ?? "",
      expectedDebit: paise(want),
      bookedDebit: paise(got),
    })
  }
  // The opening difference to equity is expected: Tally carries it too.
  const real = differences.filter(
    (d) =>
      !(d.ledgers.length === 1 && d.ledgers[0] === "Opening balance equity")
  )
  return { trialBalanceMatches: real.length === 0, differences: real }
}
