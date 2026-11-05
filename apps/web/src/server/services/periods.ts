import "server-only"

import { parseInput, periodSchema } from "@workspace/contracts"
import type { IsoTimestamp, Period } from "@workspace/contracts"
import type { OrgContext } from "./context"
import { assertCan } from "./context"

export interface PeriodLock {
  readonly period: Period
  readonly lockedBy: string
  readonly lockedAt: IsoTimestamp
}

/**
 * Locks a month: nothing can be posted into it afterwards (corrections go in
 * an open period as reversals). Throws CONFLICT if already locked. STUB.
 */
export async function lockPeriod(
  ctx: OrgContext,
  period: Period
): Promise<PeriodLock> {
  assertCan(ctx, "period", "lock")
  const p = parseInput(periodSchema, period)
  await Promise.resolve()
  return { period: p, lockedBy: ctx.userId, lockedAt: new Date().toISOString() }
}
