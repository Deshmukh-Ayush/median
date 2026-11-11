import { and, eq, sql } from "drizzle-orm"
import { expect, it } from "vitest"
import { getDb } from "../src/server/db"
import {
  connections,
  inboxItems,
  journalEntries,
  organizationSettings,
  sourceRecords,
} from "../src/server/db/schema"
import {
  connect,
  listConnections,
  syncConnection,
} from "../src/server/services/connectors"
import { devOrg } from "./setup"

it("real Razorpay test-mode sync", async () => {
  const ctx = await devOrg()
  const db = getDb()
  await db
    .update(organizationSettings)
    .set({
      gstRegistered: true,
      gstin: "29ABCDE1234F1ZW",
      stateCode: "29",
      defaultGstRateBps: 1800,
    })
    .where(eq(organizationSettings.organizationId, ctx.orgId))

  const conn = await connect(ctx, "razorpay-test-keys", {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
  })
  console.log("connection", { ...conn, id: conn.id })
  const [row] = await db
    .select({ enc: connections.credentialsEncrypted })
    .from(connections)
    .where(eq(connections.id, conn.id))
  expect(row?.enc).toMatch(/^v1\./)
  expect(row?.enc).not.toContain(process.env.RAZORPAY_KEY_SECRET ?? "x")

  const t0 = Date.now()
  const first = await syncConnection(ctx, conn.id)
  console.log("first sync", first, `${Date.now() - t0}ms`)
  const second = await syncConnection(ctx, conn.id)
  console.log("second sync", second)
  expect(second.inserted).toBe(0)

  const byStatus = await db
    .select({
      kind: sourceRecords.kind,
      status: sourceRecords.status,
      n: sql<number>`count(*)::int`,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.organizationId, ctx.orgId),
        eq(sourceRecords.connectionId, conn.id)
      )
    )
    .groupBy(sourceRecords.kind, sourceRecords.status)
  console.table(byStatus)
  const inbox = await db
    .select({ kind: inboxItems.kind, reason: inboxItems.reason })
    .from(inboxItems)
    .where(eq(inboxItems.organizationId, ctx.orgId))
    .limit(30)
  console.table(inbox)
  const [entries] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(eq(journalEntries.organizationId, ctx.orgId))
  console.log("journal entries", entries)
  console.log((await listConnections(ctx)).map((c) => ({ ...c })))
})
