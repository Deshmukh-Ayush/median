import "server-only"

import {
  ServiceError,
  listAuditFiltersSchema,
  pageOptionsSchema,
  parseInput,
} from "@workspace/contracts"
import type {
  AuditLogEntry,
  ListAuditFilters,
  Page,
  PageOptions,
} from "@workspace/contracts"
import { and, desc, eq, gte, lt, sql } from "drizzle-orm"
import { z } from "zod"

import { getDb } from "../db"
import { auditLog, user } from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { decodeCursor, encodeCursor } from "./pagination"

/** Start of an IST calendar day as an instant. */
const istStart = (date: string) => new Date(`${date}T00:00:00+05:30`)
const nextDay = (date: string) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10)

/**
 * The audit trail, newest first, paged by (at, id). Filter by entity (and
 * one record's id), actor or IST date range. Read-only: the table rejects
 * UPDATE and DELETE.
 */
export async function listAuditLog(
  ctx: OrgContext,
  cursor: string | null,
  filters: ListAuditFilters = {},
  options: PageOptions = {}
): Promise<Page<AuditLogEntry>> {
  assertCan(ctx, "ledger", "read")
  const f = parseInput(listAuditFiltersSchema, filters)
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = decodeCursor(cursor)
  const afterAt = after ? new Date(after.k) : null
  if (
    after &&
    (!afterAt ||
      Number.isNaN(afterAt.getTime()) ||
      !z.uuid().safeParse(after.id).success)
  )
    throw new ServiceError("VALIDATION", "Invalid page cursor.")

  const rows = await getDb()
    .select({
      id: auditLog.id,
      actorId: auditLog.actorId,
      actorName: user.name,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
      source: auditLog.source,
      at: auditLog.at,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .where(
      and(
        eq(auditLog.organizationId, ctx.orgId),
        f.entity ? eq(auditLog.entity, f.entity) : undefined,
        f.entityId ? eq(auditLog.entityId, f.entityId) : undefined,
        f.actorId ? eq(auditLog.actorId, f.actorId) : undefined,
        f.from ? gte(auditLog.at, istStart(f.from)) : undefined,
        f.to ? lt(auditLog.at, istStart(nextDay(f.to))) : undefined,
        afterAt && after
          ? sql`(${auditLog.at}, ${auditLog.id}) < (${afterAt}, ${after.id}::uuid)`
          : undefined
      )
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    items: page.map((r) => ({
      id: r.id,
      actor: r.actorId
        ? { id: r.actorId, name: r.actorName ?? "Former member" }
        : null,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      source: r.source,
      at: r.at.toISOString(),
    })),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ k: last.at.toISOString(), id: last.id })
        : null,
  }
}
