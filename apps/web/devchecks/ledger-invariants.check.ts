// Ledger invariants, checked against a real database. Run before every PR
// that touches posting:
//
//   npm run test:dev-db -- ledger-invariants
//
// The scans run over the whole dev database, not just this run's org, so they
// also catch bad rows written by earlier runs or by the app.

import { and, eq, sql } from "drizzle-orm"
import { expect, it } from "vitest"
import { computeLine, paise } from "@workspace/ledger"

import { getDb } from "../src/server/db"
import {
  invoiceLines,
  invoices,
  journalEntries,
  journalLines,
  ledgerAccounts,
  organizationSettings,
} from "../src/server/db/schema"
import { createInvoice } from "../src/server/services/invoices"
import { postManualEntry, reverseEntry } from "../src/server/services/ledger"
import { createParty } from "../src/server/services/parties"
import { istDateOf } from "../src/server/services/posting-rules"
import { freshDevOrg } from "./setup"

/** The append-only trigger's error (restrict_violation), under Drizzle's wrapper. */
function isAppendOnlyError(error: unknown): boolean {
  const cause: unknown =
    error instanceof Error && error.cause !== undefined ? error.cause : error
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "23001" &&
    cause instanceof Error &&
    cause.message.includes("append-only")
  )
}

async function seedPostings() {
  const ctx = await freshDevOrg("invariants")
  const db = getDb()
  await db
    .update(organizationSettings)
    .set({
      gstRegistered: true,
      gstin: "27AAHCM4321Q1Z2",
      stateCode: "27",
      compositionScheme: false,
    })
    .where(eq(organizationSettings.organizationId, ctx.orgId))
  const accounts = await db
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.organizationId, ctx.orgId))
  const id = (code: string) => accounts.find((a) => a.code === code)!.id
  const today = istDateOf(new Date())

  const rent = await postManualEntry(ctx, {
    entryDate: today,
    narration: "Rent",
    lines: [
      { accountId: id("5200"), debit: paise(60_000_00n), credit: paise(0n) },
      { accountId: id("1110"), debit: paise(0n), credit: paise(60_000_00n) },
    ],
  })
  for (const stateCode of ["27", "29"]) {
    const party = await createParty(ctx, {
      kind: "customer",
      name: `Invariant customer ${stateCode}`,
      stateCode,
    })
    await createInvoice(ctx, {
      partyId: party.id,
      invoiceDate: today,
      dueDate: today,
      lines: [
        {
          description: "Consulting",
          hsnSac: "998311",
          quantity: "1.5",
          unitPrice: 3_333_33n,
          gstRateBps: 1800,
        },
      ],
    })
  }
  return { ctx, rent, today }
}

it("every entry balances, and so does the ledger at every date", async () => {
  await seedPostings()
  const db = getDb()
  const unbalanced = await db
    .select({ entryId: journalLines.entryId })
    .from(journalLines)
    .groupBy(journalLines.entryId)
    .having(
      sql`sum(${journalLines.debitPaise}) <> sum(${journalLines.creditPaise})`
    )
  expect(unbalanced).toEqual([])

  // Running totals per org by date: any imbalance on any day shows here.
  const days = await db.execute<{ org: string; day: string; diff: string }>(sql`
    select organization_id as org, entry_date as day,
      sum(sum(debit_paise) - sum(credit_paise))
        over (partition by organization_id order by entry_date) as diff
    from ${journalLines}
    group by organization_id, entry_date
  `)
  expect(days.rows.filter((r) => BigInt(r.diff) !== 0n)).toEqual([])
})

it("posted entries can't be updated or deleted", async () => {
  const { ctx, rent } = await seedPostings()
  const db = getDb()
  const mine = and(
    eq(journalLines.organizationId, ctx.orgId),
    eq(journalLines.entryId, rent.id)
  )
  await expect(
    db.update(journalLines).set({ debitPaise: 1n }).where(mine)
  ).rejects.toSatisfy(isAppendOnlyError)
  await expect(db.delete(journalLines).where(mine)).rejects.toSatisfy(
    isAppendOnlyError
  )
  await expect(
    db
      .update(journalEntries)
      .set({ narration: "edited" })
      .where(eq(journalEntries.id, rent.id))
  ).rejects.toSatisfy(isAppendOnlyError)
  await expect(
    db.delete(journalEntries).where(eq(journalEntries.id, rent.id))
  ).rejects.toSatisfy(isAppendOnlyError)
})

it("an entry can be reversed only once", async () => {
  const { ctx, rent, today } = await seedPostings()
  await reverseEntry(ctx, rent.id, { date: today })
  await expect(
    reverseEntry(ctx, rent.id, { date: today })
  ).rejects.toMatchObject({ code: "CONFLICT" })
})

it("stored invoice GST equals GST recomputed from the stored lines", async () => {
  await seedPostings()
  const db = getDb()
  const rows = await db
    .select({
      supplyType: invoices.supplyType,
      quantityMilli: invoiceLines.quantityMilli,
      unitPrice: invoiceLines.unitPricePaise,
      rateBps: invoiceLines.gstRateBps,
      taxable: invoiceLines.taxablePaise,
      cgst: invoiceLines.cgstPaise,
      sgst: invoiceLines.sgstPaise,
      igst: invoiceLines.igstPaise,
      total: invoiceLines.totalPaise,
    })
    .from(invoiceLines)
    .innerJoin(
      invoices,
      and(
        eq(invoices.organizationId, invoiceLines.organizationId),
        eq(invoices.id, invoiceLines.invoiceId)
      )
    )
  expect(rows.length).toBeGreaterThan(0)
  const wrong = rows.filter((r) => {
    // Whether a line charges GST depends on reverse charge, LUT and the
    // org's registration; this check takes that from the stored tax and
    // recomputes everything else.
    const chargesGst = r.cgst + r.sgst + r.igst > 0n
    const expected = computeLine(
      {
        quantityMilli: r.quantityMilli,
        unitPrice: paise(r.unitPrice),
        rateBps: r.rateBps,
      },
      { intrastate: r.supplyType === "intrastate", chargesGst }
    )
    return (
      expected.taxable !== r.taxable ||
      expected.cgst !== r.cgst ||
      expected.sgst !== r.sgst ||
      expected.igst !== r.igst ||
      expected.total !== r.total
    )
  })
  expect(wrong).toEqual([])
})

// Added with the rules engine (roadmap 3.1).
it.todo("every rule-posted entry has an active rule version at posting time")
