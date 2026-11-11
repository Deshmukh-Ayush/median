import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import {
  ServiceError,
  deleteOrgDataInputSchema,
  parseInput,
} from "@workspace/contracts"
import type {
  DeleteOrgDataInput,
  DeleteOrgDataResult,
  DeletionCounts,
  DeletionSummary,
  OrgDataExport,
  OrgDataManifest,
} from "@workspace/contracts"
import { financialYearStart } from "@workspace/ledger"
import { eq, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"

import { getDb, withTransaction } from "../db"
import type { Tx } from "../db"
import {
  auditLog,
  connections,
  deletionTombstones,
  documents,
  gstRateMappings,
  inboxItems,
  invitation,
  member,
  organization,
  organizationDefaultGstRates,
  parties,
  session,
  sourceRecords,
} from "../db/schema"
import { getServerEnv } from "../env"
import { documentStore } from "../integrations/document-store"
import type { OrgContext } from "./context"
import { istDateOf } from "./posting-rules"
import { toCsv, zip } from "./zip"

// Data rights for an organisation (DPDP Act): a full export, and deletion
// under option A — everything except the books goes now; the books and the
// audit trail stay, read-only, until the retention date, then a purge job
// removes them. Owner only.

function assertOwner(ctx: OrgContext, what: string) {
  if (ctx.role !== "owner")
    throw new ServiceError("FORBIDDEN", `Only the owner can ${what}.`)
}

/** Every organisation-scoped table, in export order. `id` false: no id column. */
const ORG_TABLES: readonly {
  name: string
  id: boolean
  omit?: readonly string[]
}[] = [
  { name: "organization_settings", id: false },
  { name: "ledger_accounts", id: true },
  { name: "parties", id: true },
  { name: "journal_entries", id: true },
  { name: "journal_lines", id: true },
  { name: "period_locks", id: true },
  { name: "invoice_series", id: false },
  { name: "invoices", id: true },
  { name: "invoice_lines", id: true },
  { name: "credit_note_series", id: false },
  { name: "credit_notes", id: true },
  { name: "credit_note_lines", id: true },
  { name: "bills", id: true },
  { name: "bill_allocations", id: true },
  { name: "gst_rate_mappings", id: true },
  { name: "organization_default_gst_rates", id: true },
  // Credentials never leave the database, even encrypted.
  { name: "connections", id: true, omit: ["credentials_encrypted"] },
  { name: "source_records", id: true },
  { name: "documents", id: true },
  { name: "inbox_items", id: true },
  { name: "consents", id: true },
  { name: "audit_log", id: true },
]

const BATCH = 5_000

async function tableRows(orgId: string, t: (typeof ORG_TABLES)[number]) {
  const db = getDb()
  const all: Record<string, unknown>[] = []
  let after: string | null = null
  for (;;) {
    const where: SQL = after
      ? sql`organization_id = ${orgId} and id > ${after}::uuid`
      : sql`organization_id = ${orgId}`
    const res = await db.execute(
      t.id
        ? sql`select * from ${sql.identifier(t.name)} where ${where} order by id limit ${BATCH}`
        : sql`select * from ${sql.identifier(t.name)} where ${where}`
    )
    const rows = res.rows
    for (const r of rows) {
      for (const k of t.omit ?? []) delete r[k]
      all.push(r)
    }
    const last = rows.at(-1)?.["id"]
    if (!t.id || rows.length < BATCH || typeof last !== "string") break
    after = last
  }
  return all
}

const columnsOf = (rows: readonly Record<string, unknown>[]) => [
  ...new Set(rows.flatMap((r) => Object.keys(r))),
]

/**
 * Everything Median holds for the organisation as a zip: manifest.json plus
 * one CSV per table (members and the organisation itself included).
 * Encrypted credentials are left out. Owner only.
 */
export async function exportOrgData(ctx: OrgContext): Promise<OrgDataExport> {
  assertOwner(ctx, "export all data")
  const db = getDb()
  const [[org], members] = await db.batch([
    db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: organization.createdAt,
      })
      .from(organization)
      .where(eq(organization.id, ctx.orgId)),
    db.execute(
      sql`select m.id, m.user_id, u.name, u.email, m.role, m.created_at from member m join "user" u on u.id = m.user_id where m.organization_id = ${ctx.orgId} order by m.created_at`
    ),
  ])
  if (!org) throw new ServiceError("NOT_FOUND", "Organisation not found.")

  const enc = new TextEncoder()
  const files: OrgDataManifest["files"][number][] = []
  const entries: { name: string; data: Uint8Array }[] = []
  const add = (table: string, rows: readonly Record<string, unknown>[]) => {
    const file = `${table}.csv`
    const cols = columnsOf(rows)
    entries.push({ name: file, data: enc.encode(toCsv(cols, rows)) })
    files.push({ file, table, rows: rows.length })
  }
  add("organization", [
    { id: org.id, name: org.name, slug: org.slug, created_at: org.createdAt },
  ])
  add("members", members.rows)
  for (const t of ORG_TABLES) add(t.name, await tableRows(ctx.orgId, t))

  const exportedAt = new Date()
  const manifest: OrgDataManifest = {
    organizationId: org.id,
    organizationName: org.name,
    exportedAt: exportedAt.toISOString(),
    exportedBy: ctx.userId,
    files,
    excluded: [
      "connections.credentials_encrypted (API keys and tokens)",
      "Stored document files (download each from its document)",
    ],
  }
  entries.unshift({
    name: "manifest.json",
    data: enc.encode(JSON.stringify(manifest, null, 2)),
  })
  return {
    fileName: `median-export-${org.slug}-${istDateOf(exportedAt)}.zip`,
    contentType: "application/zip",
    bytes: zip(entries, exportedAt),
    manifest,
  }
}

// ---------------------------------------------------------------------------
// Deletion

const TOKEN_TTL_MS = 15 * 60_000

function sign(payload: string): string {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(`median-delete-org:${payload}`)
    .digest("base64url")
}

export function deletionToken(
  orgId: string,
  userId: string,
  expiresAt: Date
): string {
  const payload = Buffer.from(
    JSON.stringify([orgId, userId, expiresAt.getTime()])
  ).toString("base64url")
  return `${payload}.${sign(payload)}`
}

/** True if the token was issued to this user for this org and hasn't expired. */
export function checkDeletionToken(
  token: string,
  orgId: string,
  userId: string,
  now = new Date()
): boolean {
  const [payload, sig] = token.split(".")
  if (!payload || !sig) return false
  const want = Buffer.from(sign(payload))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false
  try {
    const raw: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString()
    )
    if (!Array.isArray(raw) || raw.length !== 3) return false
    const [o, u, exp] = raw as unknown[]
    return (
      o === orgId &&
      u === userId &&
      typeof exp === "number" &&
      exp > now.getTime()
    )
  } catch {
    return false
  }
}

/** 31 March, 8 years after the end of the financial year containing `date`. */
export function retentionUntilFor(date: string): string {
  const fyStartYear = Number(financialYearStart(date).slice(0, 4))
  return `${fyStartYear + 1 + 8}-03-31`
}

const RETAINED = [
  "ledger_accounts",
  "journal_entries",
  "journal_lines",
  "period_locks",
  "invoices",
  "invoice_lines",
  "credit_notes",
  "credit_note_lines",
  "bills",
  "bill_allocations",
  "parties",
  "audit_log",
  "consents",
  "organization_settings",
] as const

async function counts(
  db: ReturnType<typeof getDb> | Tx,
  orgId: string,
  tables: readonly string[]
) {
  const res = await db.execute(
    sql.join(
      tables.map(
        (t) =>
          sql`select ${t}::text as t, count(*)::int as n from ${sql.identifier(t)} where organization_id = ${orgId}`
      ),
      sql` union all `
    )
  )
  const out: Record<string, number> = {}
  for (const r of res.rows) out[String(r["t"])] = Number(r["n"])
  return out
}

async function summary(orgId: string, today: string): Promise<DeletionSummary> {
  const db = getDb()
  const [removedTables, retained, membersRes, filesRes] = await Promise.all([
    counts(db, orgId, [
      "connections",
      "documents",
      "inbox_items",
      "gst_rate_mappings",
      "organization_default_gst_rates",
    ]),
    counts(db, orgId, RETAINED),
    db.execute(
      sql`select (select count(*)::int from member where organization_id = ${orgId}) as members, (select count(*)::int from invitation where organization_id = ${orgId}) as invitations`
    ),
    db.execute(
      sql`select count(*)::int as n from source_records where organization_id = ${orgId} and payload <> '{}'::jsonb`
    ),
  ])
  const m = membersRes.rows[0] ?? {}
  const removed: DeletionCounts = {
    connection_credentials: removedTables["connections"] ?? 0,
    documents: removedTables["documents"] ?? 0,
    inbox_items: removedTables["inbox_items"] ?? 0,
    gst_rate_mappings:
      (removedTables["gst_rate_mappings"] ?? 0) +
      (removedTables["organization_default_gst_rates"] ?? 0),
    source_record_payloads: Number(filesRes.rows[0]?.["n"] ?? 0),
    members: Number(m["members"] ?? 0),
    invitations: Number(m["invitations"] ?? 0),
    party_contact_details: retained["parties"] ?? 0,
  }
  return { removed, retained, retentionUntil: retentionUntilFor(today) }
}

/**
 * Deletes the organisation's data in two steps, owner only.
 *   request → a summary and a token valid for 15 minutes.
 *   confirm → with the token and the organisation's name typed exactly.
 * Confirming deletes every stored file under orgs/<org>/, then in one
 * transaction removes credentials, raw payloads, documents, inbox items,
 * GST settings, members, invitations and party contact details; keeps the
 * ledger, invoices, credit notes, parties' names and GSTINs, consents and
 * the audit log read-only until `retentionUntil`; and writes a deletion
 * tombstone and an audit row. With no members left nobody can open the
 * books; the purge after retention is a scheduled job.
 */
export async function deleteOrgData(
  ctx: OrgContext,
  input: DeleteOrgDataInput
): Promise<DeleteOrgDataResult> {
  assertOwner(ctx, "delete the organisation's data")
  const i = parseInput(deleteOrgDataInputSchema, input)
  const now = new Date()
  const today = istDateOf(now)

  if (i.step === "request") {
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS)
    return {
      step: "request",
      ...(await summary(ctx.orgId, today)),
      token: deletionToken(ctx.orgId, ctx.userId, expiresAt),
      expiresAt: expiresAt.toISOString(),
    }
  }

  if (!checkDeletionToken(i.token, ctx.orgId, ctx.userId, now))
    throw new ServiceError(
      "VALIDATION",
      "That confirmation has expired. Start again."
    )
  const [org] = await getDb()
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, ctx.orgId))
  if (!org) throw new ServiceError("NOT_FOUND", "Organisation not found.")
  if (i.organizationName !== org.name.trim())
    throw new ServiceError(
      "VALIDATION",
      "Type the organisation's name exactly to confirm."
    )

  const before = await summary(ctx.orgId, today)
  // Files first: if storage fails, nothing in the database has changed yet
  // and the owner can retry.
  const filesDeleted = await documentStore().deletePrefix(`orgs/${ctx.orgId}/`)

  await withTransaction(async (tx) => {
    const org_ = ctx.orgId
    await tx
      .update(connections)
      .set({
        credentialsEncrypted: null,
        keyHint: null,
        cursor: null,
        lastError: null,
        status: "disconnected",
      })
      .where(eq(connections.organizationId, org_))
    await tx
      .update(sourceRecords)
      .set({ payload: {} })
      .where(eq(sourceRecords.organizationId, org_))
    await tx.delete(inboxItems).where(eq(inboxItems.organizationId, org_))
    await tx.delete(documents).where(eq(documents.organizationId, org_))
    await tx
      .delete(gstRateMappings)
      .where(eq(gstRateMappings.organizationId, org_))
    await tx
      .delete(organizationDefaultGstRates)
      .where(eq(organizationDefaultGstRates.organizationId, org_))
    await tx
      .update(parties)
      .set({ email: null, phone: null })
      .where(eq(parties.organizationId, org_))
    await tx.delete(invitation).where(eq(invitation.organizationId, org_))
    await tx
      .update(session)
      .set({ activeOrganizationId: null })
      .where(eq(session.activeOrganizationId, org_))
    await tx.delete(member).where(eq(member.organizationId, org_))
    await tx.insert(deletionTombstones).values({
      organizationId: org_,
      organizationName: org.name,
      requestedBy: ctx.userId,
      requestedAt: now,
      deleted: { ...before.removed, stored_files: filesDeleted },
      retained: before.retained,
      retentionUntil: before.retentionUntil,
    })
    await tx.insert(auditLog).values({
      organizationId: org_,
      actorId: ctx.userId,
      action: "organization.delete_data",
      entity: "organization",
      entityId: org_,
      before: null,
      after: {
        removed: { ...before.removed, stored_files: filesDeleted },
        retentionUntil: before.retentionUntil,
      },
      source: "web",
    })
  })

  return {
    step: "confirm",
    ...before,
    deletedAt: now.toISOString(),
    filesDeleted,
  }
}
