import "server-only"

import {
  ServiceError,
  pageOptionsSchema,
  parseInput,
  periodSchema,
} from "@workspace/contracts"
import type {
  Page,
  PageOptions,
  Period,
  PeriodLock,
} from "@workspace/contracts"
import { and, desc, eq, lt } from "drizzle-orm"

import { getDb, withTransaction } from "../db"
import { auditLog, periodLocks, user } from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { lockPeriodForPosting } from "./ledger"
import { istDateOf } from "./posting-rules"

/** The IST month now, YYYY-MM. */
export function currentPeriodIst(now: Date = new Date()): Period {
  return istDateOf(now).slice(0, 7)
}

/**
 * Locks a month that has ended: nothing posts into it afterwards, and
 * corrections go into an open month as reversals (rule 3). Takes the
 * period's exclusive lock, so it can't interleave with a posting. Writes
 * an audit row. Throws VALIDATION for the current or a future month and
 * CONFLICT if it's already locked.
 */
export async function lockPeriod(
  ctx: OrgContext,
  period: Period
): Promise<PeriodLock> {
  assertCan(ctx, "period", "lock")
  const p = parseInput(periodSchema, period)
  if (p >= currentPeriodIst())
    throw new ServiceError(
      "VALIDATION",
      "You can lock a month once it has ended."
    )

  return withTransaction(async (tx) => {
    await lockPeriodForPosting(tx, ctx.orgId, p, "lock")
    const [existing] = await tx
      .select({ id: periodLocks.id })
      .from(periodLocks)
      .where(
        and(
          eq(periodLocks.organizationId, ctx.orgId),
          eq(periodLocks.period, p)
        )
      )
    if (existing) throw new ServiceError("CONFLICT", `${p} is already locked.`)
    const [row] = await tx
      .insert(periodLocks)
      .values({ organizationId: ctx.orgId, period: p, lockedBy: ctx.userId })
      .returning({ lockedAt: periodLocks.lockedAt })
    if (!row) throw new ServiceError("CONFLICT", "Couldn't lock the period.")
    await tx.insert(auditLog).values({
      organizationId: ctx.orgId,
      actorId: ctx.userId,
      action: "period.lock",
      entity: "period",
      entityId: p,
      before: null,
      after: { period: p, lockedAt: row.lockedAt.toISOString() },
      source: "web",
    })
    const [me] = await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, ctx.userId))
    return {
      period: p,
      lockedBy: { id: ctx.userId, name: me?.name ?? "" },
      lockedAt: row.lockedAt.toISOString(),
    }
  })
}

/** Locked months, newest first, paged by period. */
export async function listPeriodLocks(
  ctx: OrgContext,
  cursor: Period | null,
  options: PageOptions = {}
): Promise<Page<PeriodLock>> {
  assertCan(ctx, "ledger", "read")
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = cursor === null ? null : parseInput(periodSchema, cursor)
  const rows = await getDb()
    .select({
      period: periodLocks.period,
      lockedById: periodLocks.lockedBy,
      lockedByName: user.name,
      lockedAt: periodLocks.lockedAt,
    })
    .from(periodLocks)
    .leftJoin(user, eq(user.id, periodLocks.lockedBy))
    .where(
      and(
        eq(periodLocks.organizationId, ctx.orgId),
        after ? lt(periodLocks.period, after) : undefined
      )
    )
    .orderBy(desc(periodLocks.period))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  return {
    items: page.map((r) => ({
      period: r.period,
      lockedBy: { id: r.lockedById, name: r.lockedByName ?? "Former member" },
      lockedAt: r.lockedAt.toISOString(),
    })),
    nextCursor: rows.length > limit ? (page.at(-1)?.period ?? null) : null,
  }
}
