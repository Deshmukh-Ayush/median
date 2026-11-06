import "server-only"

import {
  CURRENT_CONSENT_VERSION,
  ServiceError,
  consentVersionSchema,
  parseInput,
} from "@workspace/contracts"
import type { ConsentStatus } from "@workspace/contracts"
import { and, desc, eq } from "drizzle-orm"

import { getDb } from "../db"
import { auditLog, consents, user } from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"

/** Has anyone in the organisation accepted the current consent version? */
export async function getConsentStatus(
  ctx: OrgContext
): Promise<ConsentStatus> {
  assertCan(ctx, "settings", "read")
  const [row] = await getDb()
    .select({
      acceptedAt: consents.acceptedAt,
      userId: consents.userId,
      userName: user.name,
    })
    .from(consents)
    .innerJoin(user, eq(user.id, consents.userId))
    .where(
      and(
        eq(consents.organizationId, ctx.orgId),
        eq(consents.consentVersion, CURRENT_CONSENT_VERSION)
      )
    )
    .orderBy(desc(consents.acceptedAt))
    .limit(1)
  return {
    currentVersion: CURRENT_CONSENT_VERSION,
    accepted: row !== undefined,
    acceptedAt: row ? row.acceptedAt.toISOString() : null,
    acceptedBy: row ? { id: row.userId, name: row.userName } : null,
  }
}

/**
 * Records that the signed-in user accepted `consentVersion` for the
 * organisation (the user comes from the session, never an argument).
 * Idempotent. Throws VALIDATION for any version other than the current one.
 */
export async function recordConsent(
  ctx: OrgContext,
  consentVersion: string,
  evidence: { readonly ipAddress?: string; readonly userAgent?: string } = {}
): Promise<ConsentStatus> {
  assertCan(ctx, "settings", "update")
  const version = parseInput(consentVersionSchema, consentVersion)
  if (version !== CURRENT_CONSENT_VERSION) {
    throw new ServiceError(
      "VALIDATION",
      "That consent text is out of date. Reload and accept the current version."
    )
  }
  const db = getDb()
  await db.batch([
    db
      .insert(consents)
      .values({
        organizationId: ctx.orgId,
        userId: ctx.userId,
        consentVersion: version,
        ipAddress: evidence.ipAddress ?? null,
        userAgent: evidence.userAgent ?? null,
      })
      .onConflictDoNothing(),
    db.insert(auditLog).values({
      organizationId: ctx.orgId,
      actorId: ctx.userId,
      action: "consent.accept",
      entity: "consent",
      entityId: version,
      before: null,
      after: { consentVersion: version },
      source: "web",
    }),
  ])
  return getConsentStatus(ctx)
}

/**
 * Gate for anything that brings customer data in (connect, sync, import, AI
 * extraction). Throws CONSENT_REQUIRED until the current version is accepted.
 */
export async function requireConsent(ctx: OrgContext): Promise<void> {
  const [row] = await getDb()
    .select({ id: consents.id })
    .from(consents)
    .where(
      and(
        eq(consents.organizationId, ctx.orgId),
        eq(consents.consentVersion, CURRENT_CONSENT_VERSION)
      )
    )
    .limit(1)
  if (!row) {
    throw new ServiceError(
      "CONSENT_REQUIRED",
      "Accept the data-processing consent before connecting or importing data."
    )
  }
}
