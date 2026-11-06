import "server-only"

import type {
  ConnectorInfo,
  ImportFile,
  SourceRecordInput,
} from "@workspace/contracts"
import type { z } from "zod"

import type { Secret } from "./credentials"

// One interface for every data source. A connector turns provider data into
// normalised SourceRecords; the sync runner stores them idempotently and the
// posting rules (services/posting-rules.ts) only ever see SourceRecords.
//
// A new connector is one folder under integrations/ plus one line in
// registry.ts.

/** Connector-specific sync position, stored on connections.cursor. */
export type ConnectorCursor = Readonly<Record<string, number | string>>

/** Ties already-stored records to the settlement they were paid out in. */
export interface SettlementLink {
  /** Provider of the records to link (e.g. "razorpay"). */
  readonly provider: string
  readonly externalId: string
  readonly settlementExternalId: string
}

/** One unit of sync progress; the runner saves `cursor` after storing it. */
export interface SyncBatch {
  readonly records: readonly SourceRecordInput[]
  readonly settlementLinks?: readonly SettlementLink[]
  /** Cursor to resume from once this batch is stored. */
  readonly cursor: ConnectorCursor
}

export interface SyncContext<C> {
  readonly orgId: string
  readonly connectionId: string
  /** Decrypted credentials. Never log; call reveal() only at the boundary. */
  readonly credentials: Secret<C>
  readonly now: Date
}

/** The provider rejected our credentials or token: reconnect needed. */
export class ConnectorAuthError extends Error {
  override readonly name = "ConnectorAuthError"

  constructor(
    message: string,
    readonly status: "reconnect_required" | "revoked" = "reconnect_required"
  ) {
    super(message)
  }
}

/** Any other provider failure. `message` is safe to show the user. */
export class ConnectorError extends Error {
  override readonly name = "ConnectorError"
}

export interface ConnectionTestResult {
  /** Last four characters of a key or account id; never a secret. */
  readonly keyHint: string | null
  readonly mode: "live" | "test" | null
}

export interface ApiConnector<C = unknown> {
  readonly info: ConnectorInfo & { readonly authType: "api_key" | "oauth" }
  /** Validates what connect() receives (api_key) or OAuth stores. */
  readonly credentialsSchema: z.ZodType<C>
  /** Cheap authenticated call. Throws ConnectorAuthError if rejected. */
  testConnection(credentials: Secret<C>): Promise<ConnectionTestResult>
  /**
   * Yields batches of records since `cursor` (null on the first sync). Must be
   * safe to re-run from any saved cursor: the runner dedupes by externalId /
   * dedupeHash.
   */
  sync(
    ctx: SyncContext<C>,
    cursor: ConnectorCursor | null
  ): AsyncIterable<SyncBatch>
}

export interface ParsedFile {
  readonly records: readonly SourceRecordInput[]
  readonly settlementLinks?: readonly SettlementLink[]
  /** File row index of each record, when records map 1:1 to rows. */
  readonly rowIndexes?: readonly number[]
  /** Rows that couldn't be read; reported, not thrown. 0-based data rows. */
  readonly errors: readonly {
    readonly index: number
    readonly message: string
  }[]
}

export interface FileConnector {
  readonly info: ConnectorInfo & { readonly authType: "file" }
  /** Settings connect() takes (e.g. which bank account); none if omitted. */
  readonly settingsSchema?: z.ZodType<{ readonly label?: string | undefined }>
  parseFile(
    file: ImportFile,
    ctx: { readonly provider: string; readonly connectionId: string }
  ): Promise<ParsedFile>
}

export type Connector = ApiConnector | FileConnector

export function isFileConnector(c: Connector): c is FileConnector {
  return c.info.authType === "file"
}
