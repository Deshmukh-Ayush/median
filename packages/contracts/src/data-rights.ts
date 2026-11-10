// Data rights: an organisation's full export, and deletion (option A: delete
// everything except the books, which stay read-only for the legal
// retention period, then are purged).

import { z } from "zod"

import type { IsoDate, IsoTimestamp } from "./common"

export interface OrgDataManifest {
  readonly organizationId: string
  readonly organizationName: string
  readonly exportedAt: IsoTimestamp
  readonly exportedBy: string
  /** One CSV per table, with its row count. */
  readonly files: readonly {
    readonly file: string
    readonly table: string
    readonly rows: number
  }[]
  /** What's deliberately left out, e.g. encrypted credentials. */
  readonly excluded: readonly string[]
}

export interface OrgDataExport {
  /** e.g. "median-export-acme-2026-11-10.zip" */
  readonly fileName: string
  readonly contentType: "application/zip"
  /** The zip: manifest.json plus one CSV per table. */
  readonly bytes: Uint8Array
  readonly manifest: OrgDataManifest
}

/** Rows per table that a deletion removes or keeps. */
export type DeletionCounts = Readonly<Record<string, number>>

export interface DeletionSummary {
  /** Removed now: credentials, stored files, raw payloads, members… */
  readonly removed: DeletionCounts
  /** Kept read-only until `retentionUntil`: the books and the audit trail. */
  readonly retained: DeletionCounts
  /** 31 March, 8 years after the end of the current financial year. */
  readonly retentionUntil: IsoDate
}

export const deleteOrgDataInputSchema = z.discriminatedUnion("step", [
  /** Step 1: what would be deleted, and a token to confirm with. */
  z.object({ step: z.literal("request") }),
  /** Step 2: delete, with the token and the organisation's name typed out. */
  z.object({
    step: z.literal("confirm"),
    token: z.string().min(1).max(500),
    organizationName: z.string().trim().min(1).max(200),
  }),
])
export type DeleteOrgDataInput = z.input<typeof deleteOrgDataInputSchema>

export type DeleteOrgDataResult =
  | (DeletionSummary & {
      readonly step: "request"
      /** Valid for 15 minutes, for this user and organisation only. */
      readonly token: string
      readonly expiresAt: IsoTimestamp
    })
  | (DeletionSummary & {
      readonly step: "confirm"
      readonly deletedAt: IsoTimestamp
      /** Files deleted from document storage under orgs/<org>/. */
      readonly filesDeleted: number
    })
