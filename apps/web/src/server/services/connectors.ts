import "server-only"

import {
  ServiceError,
  bankStatementCredentialsSchema,
  idSchema,
  importFileOptionsSchema,
  importFileSchema,
  parseInput,
  updateConnectionSettingsInputSchema,
} from "@workspace/contracts"
import type {
  BankLineMatched,
  BankLineUnmatched,
  ConnectionStatus,
  ConnectionSummary,
  ConnectorAuthType,
  ConnectorInfo,
  ImportFile,
  ImportFileOptions,
  ImportResult,
  SyncResult,
  UpdateConnectionSettingsInput,
} from "@workspace/contracts"
import { and, asc, eq, inArray, ne } from "drizzle-orm"
import { z } from "zod"

import { getDb, withTransaction } from "../db"
import { auditLog, connections, ledgerAccounts } from "../db/schema"
import {
  ConnectorAuthError,
  ConnectorError,
  isFileConnector,
} from "../integrations/connector"
import { Secret, encryptCredentials } from "../integrations/credentials"
import { connectorInfos, getConnector } from "../integrations/registry"
import { TALLY_PROVIDER } from "../integrations/tally-import/connector"
import { hasConsent, requireConsent } from "./consent"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import {
  applySettlementLinks,
  postNewRecords,
  runSync,
  storeRecords,
} from "./sync-runner"
import { postTallyImport } from "./tally-import"

/** Data rows in CSV text: non-blank lines after the header. */
export function countCsvRows(text: string): number {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "")
  return Math.max(0, lines.length - 1)
}

export function findConnector(provider: string): ConnectorInfo {
  const connector = connectorInfos().find((c) => c.provider === provider)
  if (!connector)
    throw new ServiceError("NOT_FOUND", `No connector "${provider}".`)
  return connector
}

/** Every connector, for the Integrations gallery. Needs no organisation. */
export async function listConnectors(): Promise<readonly ConnectorInfo[]> {
  await Promise.resolve()
  return connectorInfos()
}

const summaryColumns = {
  id: connections.id,
  provider: connections.provider,
  authType: connections.authType,
  label: connections.label,
  keyHint: connections.keyHint,
  ledgerAccountId: connections.ledgerAccountId,
  settlementBankAccountId: connections.settlementBankAccountId,
  feeGstStateCode: connections.feeGstStateCode,
  status: connections.status,
  lastSyncedAt: connections.lastSyncedAt,
  lastError: connections.lastError,
}

interface SummaryRow {
  readonly id: string
  readonly provider: string
  readonly authType: ConnectorAuthType
  readonly label: string
  readonly keyHint: string | null
  readonly ledgerAccountId: string | null
  readonly settlementBankAccountId: string | null
  readonly feeGstStateCode: string | null
  readonly status: ConnectionStatus
  readonly lastSyncedAt: Date | null
  readonly lastError: string | null
}

function modeOf(provider: string): ConnectionSummary["mode"] {
  if (provider === "razorpay-test-keys") return "test"
  if (provider === "razorpay") return "live"
  return null
}

function toSummary(row: SummaryRow): ConnectionSummary {
  return {
    ...row,
    mode: modeOf(row.provider),
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
  }
}

/** The organisation's connections, oldest first (at most 100). */
export async function listConnections(
  ctx: OrgContext
): Promise<readonly ConnectionSummary[]> {
  assertCan(ctx, "ledger", "read")
  const rows = await getDb()
    .select(summaryColumns)
    .from(connections)
    .where(eq(connections.organizationId, ctx.orgId))
    .orderBy(asc(connections.createdAt), asc(connections.id))
    .limit(100)
  return rows.map(toSummary)
}

const fileSettingsSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
})

interface NewConnection {
  label: string
  keyHint: string | null
  ledgerAccountId: string | null
  credentialsEncrypted: string | null
}

/**
 * Connects an api_key or file connector: the connector validates and tests
 * the credentials, which are stored encrypted. OAuth connectors use their own
 * start/complete functions (startRazorpayOAuth). Reconnecting the same key
 * reuses its connection (and its sync cursor). Throws CONSENT_REQUIRED,
 * NOT_FOUND, VALIDATION, INTEGRATION (provider rejected the credentials).
 */
export async function connect(
  ctx: OrgContext,
  provider: string,
  credentials: unknown
): Promise<ConnectionSummary> {
  assertCan(ctx, "settings", "update")
  const id = parseInput(z.string().min(1).max(50), provider)
  const info = findConnector(id)
  if (info.availability !== "available") {
    throw new ServiceError("VALIDATION", `${info.displayName} is coming soon.`)
  }
  if (info.authType === "oauth") {
    throw new ServiceError(
      "VALIDATION",
      `${info.displayName} connects through its approval screen.`
    )
  }
  if (credentials === undefined || credentials === null) {
    throw new ServiceError("VALIDATION", "Missing credentials.")
  }

  // Validate before the consent check, so bad input is VALIDATION either way.
  const connector = getConnector(id)
  let row: NewConnection
  let test: (() => Promise<{ keyHint: string | null }>) | null = null
  if (id === "bank-statement") {
    const c = parseInput(bankStatementCredentialsSchema, credentials)
    row = {
      label: c.label,
      keyHint: null,
      ledgerAccountId: c.ledgerAccountId,
      credentialsEncrypted: null,
    }
  } else if (connector && isFileConnector(connector)) {
    const c = parseInput(
      connector.settingsSchema ?? fileSettingsSchema,
      credentials
    )
    row = {
      label: c.label ?? info.displayName,
      keyHint: null,
      ledgerAccountId: null,
      credentialsEncrypted: null,
    }
  } else if (connector) {
    const c = parseInput(connector.credentialsSchema, credentials)
    const secret = new Secret(c)
    row = {
      label: info.displayName,
      keyHint: null,
      ledgerAccountId: null,
      credentialsEncrypted: null,
    }
    const encrypt = () =>
      encryptCredentials(c, { orgId: ctx.orgId, provider: id })
    test = async () => {
      const result = await connector.testConnection(secret)
      row.credentialsEncrypted = encrypt()
      return result
    }
  } else {
    throw new ServiceError("VALIDATION", `"${id}" doesn't take credentials.`)
  }

  await requireConsent(ctx)

  if (test) {
    try {
      row.keyHint = (await test()).keyHint
    } catch (error) {
      if (error instanceof ConnectorAuthError)
        throw new ServiceError(
          "INTEGRATION",
          `${info.displayName} rejected these keys.`
        )
      if (error instanceof ConnectorError)
        throw new ServiceError("INTEGRATION", error.message)
      throw error
    }
  }

  if (row.ledgerAccountId) {
    const [account] = await getDb()
      .select({ type: ledgerAccounts.type })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.organizationId, ctx.orgId),
          eq(ledgerAccounts.id, row.ledgerAccountId)
        )
      )
      .limit(1)
    if (account?.type !== "asset")
      throw new ServiceError(
        "VALIDATION",
        "Choose a bank account (an asset account) from your chart of accounts."
      )
  }

  return withTransaction(async (tx) => {
    // Same provider and key again: reconnect the existing connection.
    const [existing] = row.keyHint
      ? await tx
          .select({ id: connections.id })
          .from(connections)
          .where(
            and(
              eq(connections.organizationId, ctx.orgId),
              eq(connections.provider, id),
              eq(connections.keyHint, row.keyHint)
            )
          )
          .limit(1)
          .for("update")
      : []
    const [saved] = existing
      ? await tx
          .update(connections)
          .set({ ...row, status: "connected", lastError: null })
          .where(
            and(
              eq(connections.organizationId, ctx.orgId),
              eq(connections.id, existing.id)
            )
          )
          .returning(summaryColumns)
      : await tx
          .insert(connections)
          .values({
            organizationId: ctx.orgId,
            provider: id,
            authType: info.authType,
            ...row,
          })
          .returning(summaryColumns)
    if (!saved)
      throw new ServiceError("CONFLICT", "Couldn't save the connection.")
    await tx.insert(auditLog).values({
      organizationId: ctx.orgId,
      actorId: ctx.userId,
      action: existing ? "connection.reconnect" : "connection.create",
      entity: "connection",
      entityId: saved.id,
      before: null,
      after: { provider: id, label: row.label, keyHint: row.keyHint },
      source: "web",
    })
    return toSummary(saved)
  })
}

/**
 * Changes a connection's settings: the bank account Razorpay settlements are
 * paid into (must be a bank account in this org), and the GST state Razorpay
 * bills its fees from. Omitted fields stay; null resets to the default.
 * Writes an audit row. Throws NOT_FOUND, VALIDATION.
 */
export async function updateConnectionSettings(
  ctx: OrgContext,
  connectionId: string,
  input: UpdateConnectionSettingsInput
): Promise<ConnectionSummary> {
  assertCan(ctx, "settings", "update")
  const id = parseInput(idSchema, connectionId)
  const s = parseInput(updateConnectionSettingsInputSchema, input)
  if (s.settlementBankAccountId) {
    const [account] = await getDb()
      .select({ isBank: ledgerAccounts.isBank })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.organizationId, ctx.orgId),
          eq(ledgerAccounts.id, s.settlementBankAccountId)
        )
      )
      .limit(1)
    if (!account?.isBank)
      throw new ServiceError("VALIDATION", "Choose one of your bank accounts.")
  }
  return withTransaction(async (tx) => {
    const [before] = await tx
      .select(summaryColumns)
      .from(connections)
      .where(
        and(eq(connections.organizationId, ctx.orgId), eq(connections.id, id))
      )
      .for("update")
    if (!before) throw new ServiceError("NOT_FOUND", "Connection not found.")
    if (!before.provider.startsWith("razorpay"))
      throw new ServiceError(
        "VALIDATION",
        "These settings apply to Razorpay connections."
      )
    const [saved] = await tx
      .update(connections)
      .set({
        ...(s.settlementBankAccountId !== undefined
          ? { settlementBankAccountId: s.settlementBankAccountId }
          : {}),
        ...(s.feeGstStateCode !== undefined
          ? { feeGstStateCode: s.feeGstStateCode }
          : {}),
      })
      .where(
        and(eq(connections.organizationId, ctx.orgId), eq(connections.id, id))
      )
      .returning(summaryColumns)
    if (!saved) throw new ServiceError("CONFLICT", "Connection changed.")
    await tx.insert(auditLog).values({
      organizationId: ctx.orgId,
      actorId: ctx.userId,
      action: "connection.settings",
      entity: "connection",
      entityId: id,
      before: {
        settlementBankAccountId: before.settlementBankAccountId,
        feeGstStateCode: before.feeGstStateCode,
      },
      after: s,
      source: "web",
    })
    return toSummary(saved)
  })
}

/** Stops syncing and deletes stored credentials; imported data stays. */
export async function disconnect(
  ctx: OrgContext,
  connectionId: string
): Promise<ConnectionSummary> {
  assertCan(ctx, "settings", "update")
  const id = parseInput(idSchema, connectionId)
  return withTransaction(async (tx) => {
    const [saved] = await tx
      .update(connections)
      .set({
        status: "disconnected",
        credentialsEncrypted: null,
        lastError: null,
      })
      .where(
        and(eq(connections.organizationId, ctx.orgId), eq(connections.id, id))
      )
      .returning(summaryColumns)
    if (!saved) throw new ServiceError("NOT_FOUND", "Connection not found.")
    await tx.insert(auditLog).values({
      organizationId: ctx.orgId,
      actorId: ctx.userId,
      action: "connection.disconnect",
      entity: "connection",
      entityId: id,
      before: null,
      after: { status: "disconnected" },
      source: "web",
    })
    return toSummary(saved)
  })
}

/**
 * Pulls new records since the saved cursor and runs the posting rules on
 * them. Safe to re-run. Throws CONSENT_REQUIRED, NOT_FOUND, CONFLICT (already
 * syncing), INTEGRATION (and marks the connection reconnect_required/revoked
 * when the provider rejects our token).
 */
export async function syncConnection(
  ctx: OrgContext,
  connectionId: string
): Promise<SyncResult> {
  assertCan(ctx, "ledger", "post")
  const id = parseInput(idSchema, connectionId)
  await requireConsent(ctx)
  const r = await runSync(ctx.orgId, id, "razorpay_rule")
  return {
    connectionId: id,
    fetched: r.fetched,
    inserted: r.inserted,
    skippedExisting: r.skippedExisting,
    posted: r.posted,
    sentToInbox: r.sentToInbox,
    status: r.status,
    lastSyncedAt: r.lastSyncedAt.toISOString(),
  }
}

/** The org's connection for a file connector, created on first import. */
async function fileConnection(
  ctx: OrgContext,
  info: ConnectorInfo,
  connectionId: string | undefined
): Promise<string> {
  const db = getDb()
  const [found] = await db
    .select({ id: connections.id })
    .from(connections)
    .where(
      and(
        eq(connections.organizationId, ctx.orgId),
        eq(connections.provider, info.provider),
        connectionId
          ? eq(connections.id, connectionId)
          : ne(connections.status, "disconnected")
      )
    )
    .orderBy(asc(connections.createdAt))
    .limit(1)
  if (found) return found.id
  if (connectionId) throw new ServiceError("NOT_FOUND", "Connection not found.")
  const [created] = await db
    .insert(connections)
    .values({
      organizationId: ctx.orgId,
      provider: info.provider,
      authType: "file",
      label: info.displayName,
    })
    .returning({ id: connections.id })
  if (!created)
    throw new ServiceError("CONFLICT", "Couldn't create the connection.")
  return created.id
}

async function markImported(orgId: string, connectionId: string) {
  await getDb()
    .update(connections)
    .set({ lastSyncedAt: new Date(), status: "connected", lastError: null })
    .where(
      and(
        eq(connections.organizationId, orgId),
        eq(connections.id, connectionId)
      )
    )
}

/**
 * Imports a file through a file connector (bank statement, Razorpay
 * settlement report, Tally XML). Unreadable rows are reported in
 * `errors`, not thrown; re-importing the same file creates no duplicates.
 * Throws CONSENT_REQUIRED, NOT_FOUND, VALIDATION (e.g. a bank statement
 * without connectionId). Bank statements return per-row `matched` and
 * `unmatched` for the rows imported this time.
 */
export async function importFile(
  ctx: OrgContext,
  provider: string,
  file: ImportFile,
  options: ImportFileOptions = {}
): Promise<ImportResult> {
  assertCan(ctx, "ledger", "post")
  const f = parseInput(importFileSchema, file)
  const o = parseInput(importFileOptionsSchema, options)
  const info = findConnector(provider)
  if (info.authType !== "file" || info.availability !== "available") {
    throw new ServiceError(
      "VALIDATION",
      `${info.displayName} doesn't take files yet.`
    )
  }
  if (provider === "bank-statement" && !o.connectionId) {
    throw new ServiceError(
      "VALIDATION",
      "Choose which bank account this statement is for."
    )
  }
  await requireConsent(ctx)

  const connector = getConnector(provider)
  if (!connector || !isFileConnector(connector)) {
    throw new ServiceError(
      "VALIDATION",
      `${info.displayName} doesn't take files yet.`
    )
  }

  const connectionId = await fileConnection(ctx, info, o.connectionId)
  const parsed = await connector.parseFile(f, { provider, connectionId })
  const stored = await storeRecords(ctx.orgId, connectionId, parsed.records)
  if (parsed.settlementLinks?.length)
    await applySettlementLinks(ctx.orgId, parsed.settlementLinks)
  if (provider === TALLY_PROVIDER) {
    const tally = await postTallyImport(ctx, connectionId)
    await markImported(ctx.orgId, connectionId)
    return {
      connectionId,
      imported: stored.inserted,
      duplicates: stored.skippedExisting,
      posted: tally.posted,
      sentToInbox: 0,
      errors: [...parsed.errors, ...stored.errors],
      tally: {
        trialBalanceMatches: tally.trialBalanceMatches,
        differences: tally.differences,
        warnings: tally.warnings,
      },
    }
  }
  const posting = await postNewRecords(ctx.orgId, connectionId, "file_import")
  await markImported(ctx.orgId, connectionId)
  // Per-row results for bank statements (new rows only).
  const matched: BankLineMatched[] = []
  const unmatched: BankLineUnmatched[] = []
  if (parsed.rowIndexes) {
    parsed.records.forEach((record, i) => {
      const key = record.externalId ?? record.dedupeHash ?? ""
      const sourceRecordId = stored.insertedIds.get(key)
      const outcome = sourceRecordId && posting.outcomes.get(sourceRecordId)
      const rowIndex = parsed.rowIndexes?.[i] ?? i
      if (!sourceRecordId || !outcome) return
      if (outcome.status === "posted" && outcome.entryId)
        matched.push({
          rowIndex,
          sourceRecordId,
          matchKind: outcome.matchKind ?? "invoice_payment",
          entryId: outcome.entryId,
        })
      else if (outcome.status === "inbox" && outcome.inboxItemId)
        unmatched.push({
          rowIndex,
          sourceRecordId,
          inboxItemId: outcome.inboxItemId,
        })
    })
  }
  return {
    connectionId,
    imported: stored.inserted,
    duplicates: stored.skippedExisting,
    posted: posting.posted,
    sentToInbox: posting.sentToInbox,
    errors: [...parsed.errors, ...stored.errors],
    ...(parsed.rowIndexes ? { matched, unmatched } : {}),
  }
}

export interface ScheduledSyncReport {
  readonly synced: number
  readonly failed: readonly {
    readonly connectionId: string
    readonly message: string
  }[]
  /** Skipped: no consent, or already syncing. */
  readonly skipped: number
}

/**
 * Syncs every connected API connection across organisations, one at a time.
 * For the cron route (Vercel Hobby allows one run a day). Never call it from
 * a user request: it acts as the system, not a member.
 */
export async function runScheduledSyncs(): Promise<ScheduledSyncReport> {
  const rows = await getDb()
    .select({ id: connections.id, orgId: connections.organizationId })
    .from(connections)
    .where(
      and(
        ne(connections.authType, "file"),
        inArray(connections.status, ["connected", "error"])
      )
    )
    .orderBy(asc(connections.lastSyncedAt))
    .limit(500)
  let synced = 0
  let skipped = 0
  const failed: { connectionId: string; message: string }[] = []
  for (const row of rows) {
    if (!(await hasConsent(row.orgId))) {
      skipped++
      continue
    }
    try {
      await runSync(row.orgId, row.id, "scheduled_sync")
      synced++
    } catch (error) {
      if (error instanceof ServiceError && error.code === "CONFLICT") {
        skipped++
        continue
      }
      failed.push({
        connectionId: row.id,
        message: error instanceof ServiceError ? error.message : "Sync failed.",
      })
    }
  }
  return { synced, failed, skipped }
}
