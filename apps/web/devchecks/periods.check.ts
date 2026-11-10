import { and, eq } from "drizzle-orm"
import { expect, it } from "vitest"
import { paise } from "@workspace/ledger"
import { getDb } from "../src/server/db"
import { ledgerAccounts } from "../src/server/db/schema"
import { listAuditLog } from "../src/server/services/audit"
import { postManualEntry, reverseEntry } from "../src/server/services/ledger"
import {
  currentPeriodIst,
  listPeriodLocks,
  lockPeriod,
} from "../src/server/services/periods"
import { istDateOf } from "../src/server/services/posting-rules"
import { freshDevOrg } from "./setup"

it("lockPeriod, posting into a locked month, and the audit trail", async () => {
  const ctx = await freshDevOrg("periods")
  const db = getDb()
  const accounts = await db
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.organizationId, ctx.orgId)))
  const id = (code: string) => accounts.find((a) => a.code === code)!.id
  const today = istDateOf(new Date())
  const lastMonth = new Date(`${today.slice(0, 7)}-01T00:00:00Z`)
  lastMonth.setUTCDate(0)
  const lastDay = lastMonth.toISOString().slice(0, 10)
  const period = lastDay.slice(0, 7)
  const entry = (date: string) => ({
    entryDate: date,
    narration: "Rent",
    lines: [
      { accountId: id("5200"), debit: paise(1_000_00n), credit: paise(0n) },
      { accountId: id("1110"), debit: paise(0n), credit: paise(1_000_00n) },
    ],
  })

  const posted = await postManualEntry(ctx, entry(lastDay))
  await expect(lockPeriod(ctx, currentPeriodIst())).rejects.toMatchObject({
    code: "VALIDATION",
  })
  const lock = await lockPeriod(ctx, period)
  expect(lock).toMatchObject({ period, lockedBy: { id: ctx.userId } })
  await expect(lockPeriod(ctx, period)).rejects.toMatchObject({
    code: "CONFLICT",
  })
  await expect(postManualEntry(ctx, entry(lastDay))).rejects.toMatchObject({
    code: "PERIOD_LOCKED",
  })
  // Rule 3: the correction goes into the open month.
  await reverseEntry(ctx, posted.id, { date: today })
  const locks = await listPeriodLocks(ctx, null)
  expect(locks.items.map((l) => l.period)).toEqual([period])

  const audit = await listAuditLog(ctx, null, {}, { limit: 2 })
  expect(audit.items).toHaveLength(2)
  expect(audit.items[1]?.action).toBe("period.lock")
  expect(audit.items[1]?.actor?.id).toBe(ctx.userId)
  const rest = await listAuditLog(ctx, audit.nextCursor, {}, { limit: 50 })
  expect(rest.items.every((i) => i.at <= audit.items[1]!.at)).toBe(true)
  const periodOnly = await listAuditLog(ctx, null, {
    entity: "period",
    entityId: period,
  })
  expect(periodOnly.items.map((i) => i.action)).toEqual(["period.lock"])
  expect(
    (await listAuditLog(ctx, null, { from: today, to: today })).items.length
  ).toBeGreaterThan(0)
})
