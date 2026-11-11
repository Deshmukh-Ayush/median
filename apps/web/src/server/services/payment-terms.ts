import "server-only"

import {
  DEFAULT_PAYMENT_TERMS_DAYS,
  parseInput,
  paymentTermsDaysSchema,
} from "@workspace/contracts"
import { eq } from "drizzle-orm"

import { getDb, withTransaction } from "../db"
import { auditLog, organizationSettings } from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"

/** Days after the invoice date an invoice falls due, unless the customer has terms. */
export async function getDefaultPaymentTerms(ctx: OrgContext): Promise<number> {
  assertCan(ctx, "ledger", "read")
  const [row] = await getDb()
    .select({ days: organizationSettings.defaultPaymentTermsDays })
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, ctx.orgId))
  return row?.days ?? DEFAULT_PAYMENT_TERMS_DAYS
}

/** Sets the organisation's default payment terms (0–365 days). */
export async function setDefaultPaymentTerms(
  ctx: OrgContext,
  days: number
): Promise<number> {
  assertCan(ctx, "settings", "update")
  const next = parseInput(paymentTermsDaysSchema, days)
  return withTransaction(async (tx) => {
    const [before] = await tx
      .select({ days: organizationSettings.defaultPaymentTermsDays })
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, ctx.orgId))
    await tx
      .insert(organizationSettings)
      .values({ organizationId: ctx.orgId, defaultPaymentTermsDays: next })
      .onConflictDoUpdate({
        target: organizationSettings.organizationId,
        set: { defaultPaymentTermsDays: next },
      })
    await tx.insert(auditLog).values({
      organizationId: ctx.orgId,
      actorId: ctx.userId,
      action: "settings.payment_terms",
      entity: "organization_settings",
      entityId: ctx.orgId,
      before: { defaultPaymentTermsDays: before?.days ?? null },
      after: { defaultPaymentTermsDays: next },
      source: "web",
    })
    return next
  })
}
