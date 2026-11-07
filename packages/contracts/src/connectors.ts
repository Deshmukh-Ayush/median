// Connector framework contract. Every data source (Razorpay, bank statements,
// settlement reports, Tally import…) produces normalised SourceRecords;
// posting rules only ever see SourceRecords, never provider payloads.

import { z } from "zod"

import type { BankLineMatched, BankLineUnmatched } from "./bank"
import { gstStateCodeSchema, idSchema, moneySchema } from "./common"
import type { IsoTimestamp } from "./common"

export type ConnectorAuthType = "api_key" | "oauth" | "file"

/** Groups for the Integrations gallery. */
export type ConnectorCategory =
  "payments" | "banks" | "accounting" | "sales_channels" | "payroll"

export interface ConnectorInfo {
  /** Registry id, e.g. "razorpay", "bank-statement". */
  readonly provider: string
  readonly displayName: string
  readonly category: ConnectorCategory
  readonly authType: ConnectorAuthType
  readonly description: string
  /** "coming_soon" connectors are listed but can't be connected yet. */
  readonly availability: "available" | "coming_soon"
  /** File connectors: accepted MIME types. Empty otherwise. */
  readonly accepts: readonly string[]
  /** API-key connectors usable only in test mode (e.g. Razorpay keys). */
  readonly testModeOnly: boolean
}

/**
 * - connected / syncing / error: normal life of a connection.
 * - reconnect_required: the provider rejected our token; reconnect.
 * - revoked: the user revoked access at the provider; reconnect.
 * - disconnected: disconnected in Median; credentials deleted.
 */
export type ConnectionStatus =
  | "connected"
  | "syncing"
  | "error"
  | "reconnect_required"
  | "revoked"
  | "disconnected"

export interface ConnectionSummary {
  readonly id: string
  readonly provider: string
  readonly authType: ConnectorAuthType
  readonly label: string
  /** Last four characters of a key or account id, for display. Never a secret. */
  readonly keyHint: string | null
  /** "live" or "test" for providers with modes (Razorpay); null otherwise. */
  readonly mode: "live" | "test" | null
  /** Bank connections: the ledger account their lines post to. */
  readonly ledgerAccountId: string | null
  /** Razorpay: bank account settlements are paid into; null → first bank account. */
  readonly settlementBankAccountId: string | null
  /**
   * Razorpay: GST state the gateway bills fees from (CGST+SGST vs IGST on
   * fee input credit); null → "29" Karnataka. For the CA to verify.
   */
  readonly feeGstStateCode: string | null
  readonly status: ConnectionStatus
  readonly lastSyncedAt: IsoTimestamp | null
  /** Safe to show the user. */
  readonly lastError: string | null
}

export const sourceRecordKindSchema = z.enum([
  "payment",
  "refund",
  "fee",
  "settlement",
  "payout",
  "bank_line",
  "order",
  "invoice",
  "party",
  "opening_balance",
])
export type SourceRecordKind = z.infer<typeof sourceRecordKindSchema>

/**
 * One normalised record from any connector. Identity is the provider's
 * `externalId`, or a `dedupeHash` (sha-256 hex, rule 12) for rows without one.
 */
export const sourceRecordSchema = z
  .object({
    provider: z.string().min(1),
    kind: sourceRecordKindSchema,
    externalId: z.string().min(1).max(200).nullable(),
    dedupeHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "dedupeHash is sha-256 hex")
      .nullable(),
    occurredAt: z.iso.datetime({ offset: true }),
    /** Non-negative magnitude in paise; `direction` carries the sign. */
    amountPaise: moneySchema.refine((v) => v >= 0n, "Amount is a magnitude"),
    direction: z.enum(["inflow", "outflow"]),
    currency: z.string().regex(/^[A-Z]{3}$/, "ISO 4217 currency code"),
    /** Bank reference / UTR, order id… */
    reference: z.string().max(500).nullable(),
    /** Settlement this record was paid out in, when known. */
    settlementExternalId: z.string().max(200).nullable(),
    /** The provider's raw data, kept for audit and re-processing. */
    payload: z.record(z.string(), z.unknown()),
  })
  .refine((r) => r.externalId !== null || r.dedupeHash !== null, {
    message: "A source record needs an externalId or a dedupeHash",
  })
export type SourceRecordInput = z.input<typeof sourceRecordSchema>
export type SourceRecord = z.output<typeof sourceRecordSchema>

/** Settings on a connection; omitted fields stay as they are, null clears. */
export const updateConnectionSettingsInputSchema = z.object({
  settlementBankAccountId: idSchema.nullable().optional(),
  feeGstStateCode: gstStateCodeSchema.nullable().optional(),
})
export type UpdateConnectionSettingsInput = z.input<
  typeof updateConnectionSettingsInputSchema
>

/** Razorpay API-key credentials: test mode only (live uses OAuth). */
export const razorpayKeyCredentialsSchema = z.object({
  keyId: z
    .string()
    .trim()
    .regex(
      /^rzp_test_[A-Za-z0-9]+$/,
      "Use test-mode keys (rzp_test_…); live accounts connect with OAuth"
    ),
  keySecret: z.string().trim().min(10).max(100),
})

/** A bank statement connection: one per bank account. */
export const bankStatementCredentialsSchema = z.object({
  label: z.string().trim().min(1).max(100),
  ledgerAccountId: idSchema,
})

export const startRazorpayOAuthInputSchema = z.object({
  /** App path to return to after Razorpay's approval screen. */
  returnTo: z
    .string()
    .regex(
      /^\/(?!\/)[\w\-/?=&%.]*$/,
      "Must be an app path, e.g. /settings/integrations"
    )
    .default("/settings/integrations"),
})
export type StartRazorpayOAuthInput = z.input<
  typeof startRazorpayOAuthInputSchema
>

export interface StartRazorpayOAuthResult {
  /** Redirect the browser here (Razorpay's approval screen, read-only scope). */
  readonly authorizeUrl: string
  readonly expiresAt: IsoTimestamp
}

/** Query parameters Razorpay sends back to the OAuth callback route. */
export const completeRazorpayOAuthInputSchema = z.union([
  z.object({
    code: z.string().min(1).max(2000),
    state: z.string().min(1).max(2000),
  }),
  z.object({
    error: z.string().min(1).max(200),
    error_description: z.string().max(1000).optional(),
    state: z.string().min(1).max(2000),
  }),
])
export type CompleteRazorpayOAuthInput = z.input<
  typeof completeRazorpayOAuthInputSchema
>

export interface CompleteRazorpayOAuthResult {
  readonly connection: ConnectionSummary
  /** The app path from startRazorpayOAuth, to redirect to. */
  readonly returnTo: string
}

export interface SyncResult {
  readonly connectionId: string
  /** Records received from the provider this run, by kind. */
  readonly fetched: Partial<Record<SourceRecordKind, number>>
  /** New source records stored (re-runs skip existing ones). */
  readonly inserted: number
  readonly skippedExisting: number
  /** Records posted directly by high-confidence rules. */
  readonly posted: number
  /** Records sent to the inbox for review. */
  readonly sentToInbox: number
  readonly status: ConnectionStatus
  readonly lastSyncedAt: IsoTimestamp
}

/** A file handed to a file connector. */
export const importFileSchema = z.discriminatedUnion("kind", [
  /** Raw text (CSV, Tally XML), parsed on the server. */
  z.object({
    kind: z.literal("text"),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(100),
    text: z.string().max(20_000_000),
  }),
  /** Rows already extracted (e.g. PDF statements via the AI module). */
  z.object({
    kind: z.literal("rows"),
    fileName: z.string().min(1).max(255),
    rows: z.array(z.unknown()).max(50_000),
  }),
])
export type ImportFile = z.input<typeof importFileSchema>

export const importFileOptionsSchema = z.object({
  /** Required for bank statements: which bank connection the file is for. */
  connectionId: idSchema.optional(),
})
export type ImportFileOptions = z.input<typeof importFileOptionsSchema>

export interface ImportResult {
  readonly connectionId: string
  /** New records stored. */
  readonly imported: number
  /** Already imported before (same externalId / dedupe hash). */
  readonly duplicates: number
  readonly posted: number
  readonly sentToInbox: number
  /** Rows that couldn't be read; reported, not thrown. */
  readonly errors: readonly {
    readonly index: number
    readonly message: string
  }[]
  /** Bank statements only: new lines booked by a deterministic match. */
  readonly matched?: readonly BankLineMatched[]
  /** Bank statements only: new lines sent to the inbox. */
  readonly unmatched?: readonly BankLineUnmatched[]
}

/** @deprecated Kept for syncRazorpay(); use SyncResult. */
export interface SyncRazorpayResult {
  readonly fetched: {
    readonly payments: number
    readonly refunds: number
    readonly settlements: number
  }
  readonly inserted: number
  readonly skippedExisting: number
  readonly posted: number
  readonly sentToInbox: number
  readonly lastSyncedAt: IsoTimestamp
}
