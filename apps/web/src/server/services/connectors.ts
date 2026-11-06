import "server-only"

import {
  ServiceError,
  bankStatementCredentialsSchema,
  idSchema,
  importFileOptionsSchema,
  importFileSchema,
  parseInput,
  razorpayKeyCredentialsSchema,
} from "@workspace/contracts"
import type {
  ConnectionSummary,
  ConnectorInfo,
  ImportFile,
  ImportFileOptions,
  ImportResult,
  SyncResult,
} from "@workspace/contracts"
import { z } from "zod"

import { requireConsent } from "./consent"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { STUB_ACCOUNTS, timestampDaysAgo } from "./stub-data"

// STUB until the connector registry lands (integrations/registry.ts, Day 2).
const CONNECTORS: readonly ConnectorInfo[] = [
  {
    provider: "razorpay",
    displayName: "Razorpay",
    category: "payments",
    authType: "oauth",
    description: "Payments, refunds, fees and settlements, read-only.",
    availability: "available",
    accepts: [],
    testModeOnly: false,
  },
  {
    provider: "razorpay-test-keys",
    displayName: "Razorpay (test keys)",
    category: "payments",
    authType: "api_key",
    description: "Connect a Razorpay test account with API keys.",
    availability: "available",
    accepts: [],
    testModeOnly: true,
  },
  {
    provider: "razorpay-settlement-report",
    displayName: "Razorpay settlement report",
    category: "payments",
    authType: "file",
    description:
      "Upload the settlement report CSV from the Razorpay dashboard.",
    availability: "available",
    accepts: ["text/csv"],
    testModeOnly: false,
  },
  {
    provider: "bank-statement",
    displayName: "Bank statement",
    category: "banks",
    authType: "file",
    description: "CSV or PDF statements from any Indian bank.",
    availability: "available",
    accepts: ["text/csv", "application/pdf"],
    testModeOnly: false,
  },
  {
    provider: "tally-import",
    displayName: "Import from Tally",
    category: "accounting",
    authType: "file",
    description:
      "Masters, opening balances and vouchers from a Tally XML export.",
    availability: "coming_soon",
    accepts: ["application/xml", "text/xml"],
    testModeOnly: false,
  },
  {
    provider: "zoho-books-import",
    displayName: "Import from Zoho Books",
    category: "accounting",
    authType: "file",
    description: "Zoho Books CSV exports.",
    availability: "coming_soon",
    accepts: ["text/csv"],
    testModeOnly: false,
  },
  {
    provider: "stripe",
    displayName: "Stripe",
    category: "payments",
    authType: "oauth",
    description: "Payments and payouts.",
    availability: "coming_soon",
    accepts: [],
    testModeOnly: false,
  },
  {
    provider: "cashfree",
    displayName: "Cashfree",
    category: "payments",
    authType: "api_key",
    description: "Payments and settlements.",
    availability: "coming_soon",
    accepts: [],
    testModeOnly: false,
  },
  {
    provider: "shopify",
    displayName: "Shopify",
    category: "sales_channels",
    authType: "oauth",
    description: "Orders, refunds and payouts.",
    availability: "coming_soon",
    accepts: [],
    testModeOnly: false,
  },
]

const stubConnections: readonly ConnectionSummary[] = [
  {
    id: "00000000-0000-4000-8000-0000000000c1",
    provider: "razorpay",
    authType: "oauth",
    label: "Razorpay",
    keyHint: "…Xy9Q",
    mode: "live",
    ledgerAccountId: null,
    status: "connected",
    lastSyncedAt: timestampDaysAgo(0),
    lastError: null,
  },
  {
    id: "00000000-0000-4000-8000-0000000000c2",
    provider: "bank-statement",
    authType: "file",
    label: "HDFC current a/c",
    keyHint: null,
    mode: null,
    ledgerAccountId: STUB_ACCOUNTS.bank.id,
    status: "connected",
    lastSyncedAt: timestampDaysAgo(2),
    lastError: null,
  },
]

const settlementReportCredentialsSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
})

/**
 * Validates connect() credentials with the connector's schema. Razorpay keys
 * must be test-mode (rzp_test_…); live accounts use OAuth.
 */
function parseCredentials(
  provider: string,
  credentials: unknown
): { readonly label: string | null; readonly keyHint: string | null } {
  switch (provider) {
    case "razorpay-test-keys": {
      const c = parseInput(razorpayKeyCredentialsSchema, credentials)
      return { label: null, keyHint: `…${c.keyId.slice(-4)}` }
    }
    case "bank-statement": {
      const c = parseInput(bankStatementCredentialsSchema, credentials)
      return { label: c.label, keyHint: null }
    }
    case "razorpay-settlement-report": {
      const c = parseInput(settlementReportCredentialsSchema, credentials)
      return { label: c.label ?? null, keyHint: null }
    }
    default:
      throw new ServiceError(
        "VALIDATION",
        `"${provider}" doesn't take credentials.`
      )
  }
}

/** Data rows in CSV text: non-blank lines after the header. */
export function countCsvRows(text: string): number {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "")
  return Math.max(0, lines.length - 1)
}

export function findConnector(provider: string): ConnectorInfo {
  const connector = CONNECTORS.find((c) => c.provider === provider)
  if (!connector)
    throw new ServiceError("NOT_FOUND", `No connector "${provider}".`)
  return connector
}

/** Every connector, for the Integrations gallery. Needs no organisation. */
export async function listConnectors(): Promise<readonly ConnectorInfo[]> {
  await Promise.resolve()
  return CONNECTORS
}

/** The organisation's connections. STUB. */
export async function listConnections(
  ctx: OrgContext
): Promise<readonly ConnectionSummary[]> {
  assertCan(ctx, "ledger", "read")
  await Promise.resolve()
  return stubConnections
}

/**
 * Connects an api_key or file connector: the connector validates and tests
 * the credentials, which are stored encrypted. OAuth connectors use their own
 * start/complete functions (startRazorpayOAuth). Throws CONSENT_REQUIRED,
 * NOT_FOUND, VALIDATION, INTEGRATION (provider rejected the credentials). STUB.
 */
export async function connect(
  ctx: OrgContext,
  provider: string,
  credentials: unknown
): Promise<ConnectionSummary> {
  assertCan(ctx, "settings", "update")
  const id = parseInput(z.string().min(1).max(50), provider)
  const connector = findConnector(id)
  if (connector.availability !== "available") {
    throw new ServiceError(
      "VALIDATION",
      `${connector.displayName} is coming soon.`
    )
  }
  if (connector.authType === "oauth") {
    throw new ServiceError(
      "VALIDATION",
      `${connector.displayName} connects through its approval screen.`
    )
  }
  if (credentials === undefined || credentials === null) {
    throw new ServiceError("VALIDATION", "Missing credentials.")
  }
  const parsed = parseCredentials(connector.provider, credentials)
  await requireConsent(ctx)
  return {
    id: crypto.randomUUID(),
    provider: connector.provider,
    authType: connector.authType,
    label: parsed.label ?? connector.displayName,
    keyHint: parsed.keyHint,
    mode: connector.testModeOnly ? "test" : null,
    ledgerAccountId: null,
    status: "connected",
    lastSyncedAt: null,
    lastError: null,
  }
}

/** Stops syncing and deletes stored credentials; imported data stays. STUB. */
export async function disconnect(
  ctx: OrgContext,
  connectionId: string
): Promise<ConnectionSummary> {
  assertCan(ctx, "settings", "update")
  const id = parseInput(idSchema, connectionId)
  const connection = stubConnections.find((c) => c.id === id)
  if (!connection) throw new ServiceError("NOT_FOUND", "Connection not found.")
  await Promise.resolve()
  return { ...connection, status: "disconnected", keyHint: null }
}

/**
 * Pulls new records since the saved cursor and runs the posting rules on
 * them. Safe to re-run. Throws CONSENT_REQUIRED, NOT_FOUND, CONFLICT (already
 * syncing), INTEGRATION (and marks the connection reconnect_required/revoked
 * when the provider rejects our token). STUB.
 */
export async function syncConnection(
  ctx: OrgContext,
  connectionId: string
): Promise<SyncResult> {
  assertCan(ctx, "ledger", "post")
  const id = parseInput(idSchema, connectionId)
  const connection = stubConnections.find((c) => c.id === id)
  if (!connection) throw new ServiceError("NOT_FOUND", "Connection not found.")
  if (connection.authType === "file") {
    throw new ServiceError(
      "VALIDATION",
      "File connections import with importFile."
    )
  }
  await requireConsent(ctx)
  return {
    connectionId: id,
    fetched: { payment: 148, refund: 3, fee: 148, settlement: 9 },
    inserted: 308,
    skippedExisting: 0,
    posted: 302,
    sentToInbox: 6,
    status: "connected",
    lastSyncedAt: new Date().toISOString(),
  }
}

/**
 * Imports a file through a file connector (bank statement, Razorpay
 * settlement report, later Tally XML). Unreadable rows are reported in
 * `errors`, not thrown; re-importing the same file creates no duplicates.
 * Throws CONSENT_REQUIRED, NOT_FOUND, VALIDATION (e.g. a bank statement
 * without connectionId). STUB.
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
  const connector = findConnector(provider)
  if (connector.authType !== "file" || connector.availability !== "available") {
    throw new ServiceError(
      "VALIDATION",
      `${connector.displayName} doesn't take files yet.`
    )
  }
  if (provider === "bank-statement" && !o.connectionId) {
    throw new ServiceError(
      "VALIDATION",
      "Choose which bank account this statement is for."
    )
  }
  await requireConsent(ctx)
  const rows = f.kind === "rows" ? f.rows.length : countCsvRows(f.text)
  const posted = Math.floor(rows * 0.8)
  return {
    connectionId: o.connectionId ?? crypto.randomUUID(),
    imported: rows,
    duplicates: 0,
    posted,
    sentToInbox: rows - posted,
    errors: [],
  }
}
