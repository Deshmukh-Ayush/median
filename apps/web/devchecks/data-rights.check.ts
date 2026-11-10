import { and, eq } from "drizzle-orm"
import { afterEach, expect, it } from "vitest"
import { paise } from "@workspace/ledger"
import { getDb } from "../src/server/db"
import {
  auditLog,
  connections,
  deletionTombstones,
  documents,
  journalEntries,
  ledgerAccounts,
  member,
  parties,
} from "../src/server/db/schema"
import { setDocumentStoreForTests } from "../src/server/integrations/document-store"
import type { DocumentStore } from "../src/server/integrations/document-store"
import {
  deleteOrgData,
  exportOrgData,
} from "../src/server/services/data-rights"
import { registerDocument } from "../src/server/services/documents"
import { postManualEntry } from "../src/server/services/ledger"
import { createParty } from "../src/server/services/parties"
import { istDateOf } from "../src/server/services/posting-rules"
import { freshDevOrg } from "./setup"

afterEach(() => setDocumentStoreForTests(null))

function memoryStore(): DocumentStore & { files: Map<string, Blob> } {
  const files = new Map<string, Blob>()
  return {
    files,
    put: (p, b) => (files.set(p, b), Promise.resolve({ pathname: p })),
    get: () => Promise.resolve(null),
    delete: (p) => (files.delete(p), Promise.resolve()),
    deletePrefix: (prefix) => {
      const gone = [...files.keys()].filter((k) => k.startsWith(prefix))
      for (const k of gone) files.delete(k)
      return Promise.resolve(gone.length)
    },
  }
}

it("exportOrgData, then deleteOrgData (option A)", async () => {
  const ctx = await freshDevOrg("rights")
  const db = getDb()
  const store = memoryStore()
  setDocumentStoreForTests(store)
  // Another org's file must survive.
  store.files.set("orgs/someone-else/documents/x", new Blob(["keep"]))

  const accounts = await db
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.organizationId, ctx.orgId))
  const id = (code: string) => accounts.find((a) => a.code === code)!.id
  const entry = await postManualEntry(ctx, {
    entryDate: istDateOf(new Date()),
    narration: "Capital",
    lines: [
      { accountId: id("1110"), debit: paise(1_000_00n), credit: paise(0n) },
      { accountId: id("3100"), debit: paise(0n), credit: paise(1_000_00n) },
    ],
  })
  const party = await createParty(ctx, {
    kind: "customer",
    name: "Asha Rao",
    email: "asha@example.invalid",
    phone: "+919800000000",
  })
  await registerDocument(ctx, {
    kind: "bill",
    file: new File(["%PDF-1.7\n"], "bill.pdf", { type: "application/pdf" }),
  })
  await db.insert(connections).values({
    organizationId: ctx.orgId,
    provider: "razorpay-test-keys",
    authType: "api_key",
    label: "Razorpay",
    credentialsEncrypted: "v1.not-real",
  })

  const exported = await exportOrgData(ctx)
  expect(Buffer.from(exported.bytes.subarray(0, 2)).toString()).toBe("PK")
  const files = Object.fromEntries(
    exported.manifest.files.map((f) => [f.table, f.rows])
  )
  expect(files).toMatchObject({
    journal_entries: 1,
    journal_lines: 2,
    parties: 1,
    documents: 1,
    connections: 1,
    members: 1,
  })
  expect(Buffer.from(exported.bytes).includes("v1.not-real")).toBe(false)

  const req = await deleteOrgData(ctx, { step: "request" })
  if (req.step !== "request") throw new Error("expected a request")
  console.log("deletion summary", req)
  expect(req.removed).toMatchObject({
    documents: 1,
    connection_credentials: 1,
    members: 1,
  })
  await expect(
    deleteOrgData(ctx, {
      step: "confirm",
      token: req.token,
      organizationName: "wrong",
    })
  ).rejects.toMatchObject({ code: "VALIDATION" })
  await expect(
    deleteOrgData(ctx, {
      step: "confirm",
      token: `${req.token}x`,
      organizationName: "Dev check rights",
    })
  ).rejects.toMatchObject({ code: "VALIDATION" })
  await expect(
    deleteOrgData({ ...ctx, role: "finance" }, { step: "request" })
  ).rejects.toMatchObject({ code: "FORBIDDEN" })

  const done = await deleteOrgData(ctx, {
    step: "confirm",
    token: req.token,
    organizationName: "Dev check rights",
  })
  if (done.step !== "confirm") throw new Error("expected a confirmation")
  expect(done.filesDeleted).toBe(1)
  expect([...store.files.keys()]).toEqual(["orgs/someone-else/documents/x"])

  const [[conn], docs, members, [p], entries, [tomb], [audit]] = await db.batch(
    [
      db
        .select({ c: connections.credentialsEncrypted, s: connections.status })
        .from(connections)
        .where(eq(connections.organizationId, ctx.orgId)),
      db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.organizationId, ctx.orgId)),
      db
        .select({ id: member.id })
        .from(member)
        .where(eq(member.organizationId, ctx.orgId)),
      db
        .select({
          email: parties.email,
          phone: parties.phone,
          name: parties.name,
        })
        .from(parties)
        .where(eq(parties.id, party.id)),
      db
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(eq(journalEntries.organizationId, ctx.orgId)),
      db
        .select()
        .from(deletionTombstones)
        .where(eq(deletionTombstones.organizationId, ctx.orgId)),
      db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.organizationId, ctx.orgId),
            eq(auditLog.action, "organization.delete_data")
          )
        ),
    ]
  )
  expect(conn).toEqual({ c: null, s: "disconnected" })
  expect(docs).toEqual([])
  expect(members).toEqual([])
  expect(p).toEqual({ email: null, phone: null, name: "Asha Rao" })
  expect(entries.map((e) => e.id)).toEqual([entry.id])
  expect(tomb?.retentionUntil).toBe(done.retentionUntil)
  expect(audit?.action).toBe("organization.delete_data")
})
