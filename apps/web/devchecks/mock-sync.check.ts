import { and, eq, sql } from "drizzle-orm"
import { expect, it } from "vitest"
import { getDb } from "../src/server/db"
import {
  connections,
  inboxItems,
  journalEntries,
  journalLines,
  ledgerAccounts,
  organizationSettings,
  sourceRecords,
} from "../src/server/db/schema"
import { setRazorpayClientOptionsForTests } from "../src/server/integrations/razorpay/connector"
import {
  connect,
  importFile,
  syncConnection,
} from "../src/server/services/connectors"
import { devOrg } from "./setup"

const now = Math.floor(Date.now() / 1000)
const run = `m${now}`
const pay = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `pay_${run}${n}`,
  entity: "payment",
  amount: 118_000,
  currency: "INR",
  status: "captured",
  order_id: null,
  invoice_id: null,
  method: "upi",
  amount_refunded: 0,
  captured: true,
  description: null,
  email: null,
  contact: null,
  notes: [],
  fee: 2_360,
  tax: 360,
  created_at: now - 86_400 * 3 + n,
  ...extra,
})
const payments = [
  pay(1),
  pay(2),
  pay(3, { notes: { product: "devcheck-plan" } }),
  pay(4, { status: "failed", captured: false, fee: null, tax: null }),
]
const refunds = [
  {
    id: `rfnd_${run}1`,
    entity: "refund",
    amount: 118_000,
    currency: "INR",
    payment_id: payments[0]!.id,
    notes: [],
    status: "processed",
    created_at: now - 86_400 * 2,
  },
  {
    id: `rfnd_${run}2`,
    entity: "refund",
    amount: 59_000,
    currency: "INR",
    payment_id: payments[1]!.id,
    notes: [],
    status: "processed",
    created_at: now - 86_400 * 2,
  },
]
const settlements = [
  // pay_2 + pay_3 - fees - partial refund = 118000*2 - 2360*2 - 59000
  {
    id: `setl_${run}1`,
    entity: "settlement",
    amount: 118_000 * 2 - 2_360 * 2 - 59_000,
    status: "processed",
    fees: 4_720,
    tax: 720,
    utr: `UTR${run}A`,
    created_at: now - 86_400,
  },
  {
    id: `setl_${run}2`,
    entity: "settlement",
    amount: 50_000,
    status: "processed",
    fees: 0,
    tax: 0,
    utr: `UTR${run}B`,
    created_at: now - 3_600,
  },
]
const recon = [
  ...[payments[1]!, payments[2]!].map((p) => ({
    entity_id: p.id,
    type: "payment",
    debit: 0,
    credit: 115_640,
    amount: 118_000,
    currency: "INR",
    fee: 2_360,
    tax: 360,
    settled: true,
    settlement_id: settlements[0]!.id,
    settlement_utr: `UTR${run}A`,
    created_at: p.created_at,
    settled_at: now - 86_400,
  })),
  {
    entity_id: refunds[1]!.id,
    type: "refund",
    debit: 59_000,
    credit: 0,
    amount: 59_000,
    currency: "INR",
    fee: 0,
    tax: 0,
    settled: true,
    settlement_id: settlements[0]!.id,
    settlement_utr: `UTR${run}A`,
    created_at: now,
    settled_at: now,
  },
]
const json = (b: unknown) =>
  new Response(JSON.stringify(b), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
const coll = (items: unknown[]) =>
  json({ entity: "collection", count: items.length, items })
setRazorpayClientOptionsForTests({
  sleep: () => Promise.resolve(),
  fetch: (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const skip = Number(url.searchParams.get("skip") ?? 0)
    const page = (items: unknown[]) => coll(skip > 0 ? [] : items)
    if (url.pathname.endsWith("/settlements/recon/combined")) {
      const day = Number(url.searchParams.get("day"))
      const d1 = new Date(
        (settlements[0]!.created_at + 19_800) * 1000
      ).getUTCDate()
      return Promise.resolve(page(day === d1 ? recon : []))
    }
    if (url.pathname.endsWith("/payments"))
      return Promise.resolve(page(payments))
    if (url.pathname.endsWith("/refunds")) return Promise.resolve(page(refunds))
    if (url.pathname.endsWith("/settlements"))
      return Promise.resolve(page(settlements))
    return Promise.resolve(new Response("{}", { status: 404 }))
  },
})

it("sync runner + posting rules on the dev DB (mocked Razorpay API)", async () => {
  const ctx = await devOrg()
  const db = getDb()
  await db
    .update(organizationSettings)
    .set({
      gstRegistered: true,
      gstin: "29ABCDE1234F1Z5",
      stateCode: "29",
      defaultGstRateBps: 1800,
    })
    .where(eq(organizationSettings.organizationId, ctx.orgId))
  const conn = await connect(ctx, "razorpay-test-keys", {
    keyId: `rzp_test_${run}`,
    keySecret: "devcheck-secret-123",
  })
  const first = await syncConnection(ctx, conn.id)
  console.log("first", first)
  const second = await syncConnection(ctx, conn.id)
  console.log("second", second)
  expect(second.inserted).toBe(0)
  expect(second.posted + second.sentToInbox).toBe(0)

  const recs = await db
    .select({
      kind: sourceRecords.kind,
      ext: sourceRecords.externalId,
      status: sourceRecords.status,
      setl: sourceRecords.settlementExternalId,
      entry: sourceRecords.journalEntryId,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.organizationId, ctx.orgId),
        eq(sourceRecords.connectionId, conn.id)
      )
    )
    .orderBy(sourceRecords.kind, sourceRecords.externalId)
  console.table(recs)
  const inbox = await db
    .select({ kind: inboxItems.kind, reason: inboxItems.reason })
    .from(inboxItems)
    .innerJoin(sourceRecords, eq(sourceRecords.id, inboxItems.sourceId))
    .where(
      and(
        eq(inboxItems.organizationId, ctx.orgId),
        eq(sourceRecords.connectionId, conn.id)
      )
    )
  console.table(inbox)
  // Clearing balance for this run = settlement 2 only (unreconciled, in inbox) + refunded pay_1 net of fees.
  const bal = await db
    .select({
      code: ledgerAccounts.code,
      name: ledgerAccounts.name,
      dr: sql<string>`sum(${journalLines.debitPaise})`,
      cr: sql<string>`sum(${journalLines.creditPaise})`,
    })
    .from(journalLines)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(
      sourceRecords,
      eq(sourceRecords.journalEntryId, journalEntries.id)
    )
    .where(
      and(
        eq(journalLines.organizationId, ctx.orgId),
        eq(sourceRecords.connectionId, conn.id)
      )
    )
    .groupBy(ledgerAccounts.code, ledgerAccounts.name)
    .orderBy(ledgerAccounts.code)
  console.table(bal)
  const status = await db
    .select({ s: connections.status, c: connections.cursor })
    .from(connections)
    .where(eq(connections.id, conn.id))
  console.log(status)

  // Settlement report fallback, same shapes.
  const csv = [
    "entity_id,type,debit,credit,amount,currency,fee,tax,settlement_id,settlement_utr,created_at,settled_at,payment_id",
    `pay_${run}R1,payment,0,1156.40,1180.00,INR,23.60,3.60,setl_${run}R,UTRR,2026-11-02 10:00:00,2026-11-04 09:00:00,`,
  ].join("\n")
  const file = {
    kind: "text",
    fileName: "r.csv",
    mimeType: "text/csv",
    text: csv,
  } as const
  const imp1 = await importFile(ctx, "razorpay-settlement-report", file)
  const imp2 = await importFile(ctx, "razorpay-settlement-report", file)
  console.log("import", imp1, imp2)
  expect(imp2.imported).toBe(0)
})
