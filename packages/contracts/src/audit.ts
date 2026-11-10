// The audit trail (every change to the books) and period locks.

import { z } from "zod"

import type { IsoTimestamp, Period } from "./common"
import { isoDateSchema } from "./common"

export interface AuditLogEntry {
  readonly id: string
  /** Null for system actions; see `source`. */
  readonly actor: { readonly id: string; readonly name: string } | null
  /** e.g. "journal_entry.post", "inbox_item.approve", "period.lock" */
  readonly action: string
  readonly entity: string
  readonly entityId: string
  /** JSON snapshots; amounts are integer-paise strings. */
  readonly before: unknown
  readonly after: unknown
  /** "web", "razorpay_rule", "bank_match", "invoice"… */
  readonly source: string
  readonly at: IsoTimestamp
}

export const listAuditFiltersSchema = z
  .object({
    /** e.g. "journal_entry", "invoice", "period". */
    entity: z.string().trim().min(1).max(50).optional(),
    /** With `entity`: one record's history. */
    entityId: z.string().trim().min(1).max(100).optional(),
    actorId: z.string().trim().min(1).max(100).optional(),
    /** IST calendar dates, inclusive. */
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine((f) => !f.entityId || f.entity, "entityId needs entity")
  .refine((f) => !f.from || !f.to || f.from <= f.to, "'from' is after 'to'")
export type ListAuditFilters = z.input<typeof listAuditFiltersSchema>

export interface PeriodLock {
  readonly period: Period
  readonly lockedBy: { readonly id: string; readonly name: string }
  readonly lockedAt: IsoTimestamp
}
