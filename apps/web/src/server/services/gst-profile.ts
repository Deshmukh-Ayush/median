import "server-only"

import {
  ServiceError,
  listMappingsFiltersSchema,
  pageOptionsSchema,
  parseInput,
  updateGstProfileInputSchema,
  upsertGstRateMappingInputSchema,
} from "@workspace/contracts"
import type {
  GstProfile,
  GstRateMapping,
  GstRateMappingKind,
  Page,
  PageOptions,
  UpdateGstProfileInput,
  UpsertGstRateMappingInput,
} from "@workspace/contracts"
import { and, asc, eq, gt, or, sql } from "drizzle-orm"

import { getDb } from "../db"
import { auditLog, gstRateMappings, organizationSettings } from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { decodeCursor, encodeCursor } from "./pagination"

const EMPTY_PROFILE: GstProfile = {
  legalName: null,
  gstin: null,
  stateCode: null,
  gstRegistered: false,
  compositionScheme: false,
  defaultGstRateBps: null,
}

const profileColumns = {
  legalName: organizationSettings.legalName,
  gstin: organizationSettings.gstin,
  stateCode: organizationSettings.stateCode,
  gstRegistered: organizationSettings.gstRegistered,
  compositionScheme: organizationSettings.compositionScheme,
  defaultGstRateBps: organizationSettings.defaultGstRateBps,
}

/** The organisation's GST profile. Unregistered until onboarding sets it. */
export async function getGstProfile(ctx: OrgContext): Promise<GstProfile> {
  assertCan(ctx, "settings", "read")
  const [row] = await getDb()
    .select(profileColumns)
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, ctx.orgId))
    .limit(1)
  return row ?? EMPTY_PROFILE
}

/** Replaces the GST profile, with an audit row. Owner/finance only. */
export async function updateGstProfile(
  ctx: OrgContext,
  input: UpdateGstProfileInput
): Promise<GstProfile> {
  assertCan(ctx, "settings", "update")
  const profile = parseInput(updateGstProfileInputSchema, input)
  // State code follows the GSTIN when only the GSTIN is given.
  const next: GstProfile = {
    ...profile,
    stateCode: profile.stateCode ?? profile.gstin?.slice(0, 2) ?? null,
  }
  const before = await getGstProfile(ctx)
  const db = getDb()
  await db.batch([
    db
      .insert(organizationSettings)
      .values({ organizationId: ctx.orgId, ...next })
      .onConflictDoUpdate({
        target: organizationSettings.organizationId,
        set: next,
      }),
    db.insert(auditLog).values({
      organizationId: ctx.orgId,
      actorId: ctx.userId,
      action: "gst_profile.update",
      entity: "organization",
      entityId: ctx.orgId,
      before,
      after: next,
      source: "web",
    }),
  ])
  return next
}

// ---------------------------------------------------------------------------
// Product / stream → GST rate mapping

const mappingColumns = {
  id: gstRateMappings.id,
  kind: gstRateMappings.kind,
  key: gstRateMappings.key,
  label: gstRateMappings.label,
  hsnSac: gstRateMappings.hsnSac,
  gstRateBps: gstRateMappings.gstRateBps,
  revenueAccountId: gstRateMappings.revenueAccountId,
}

/** Ordered by kind, then key. */
export async function listGstRateMappings(
  ctx: OrgContext,
  cursor: string | null,
  filters: { readonly kind?: GstRateMappingKind } = {},
  options: PageOptions = {}
): Promise<Page<GstRateMapping>> {
  assertCan(ctx, "ledger", "read")
  const f = parseInput(listMappingsFiltersSchema, filters)
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = decodeCursor(cursor)
  const [afterKind = "", afterKey = ""] = after ? after.k.split("\u0000") : []

  const rows = await getDb()
    .select(mappingColumns)
    .from(gstRateMappings)
    .where(
      and(
        eq(gstRateMappings.organizationId, ctx.orgId),
        f.kind ? eq(gstRateMappings.kind, f.kind) : undefined,
        after
          ? or(
              gt(sql`${gstRateMappings.kind}::text`, afterKind),
              and(
                eq(sql`${gstRateMappings.kind}::text`, afterKind),
                gt(gstRateMappings.key, afterKey)
              )
            )
          : undefined
      )
    )
    .orderBy(asc(gstRateMappings.kind), asc(gstRateMappings.key))
    .limit(limit + 1)

  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ k: `${last.kind}\u0000${last.key}`, id: last.id })
        : null,
  }
}

/** Creates or replaces the mapping for (kind, key), with an audit row. */
export async function upsertGstRateMapping(
  ctx: OrgContext,
  input: UpsertGstRateMappingInput
): Promise<GstRateMapping> {
  assertCan(ctx, "settings", "update")
  const m = parseInput(upsertGstRateMappingInputSchema, input)
  const db = getDb()
  const [[saved]] = await db.batch([
    db
      .insert(gstRateMappings)
      .values({ organizationId: ctx.orgId, ...m })
      .onConflictDoUpdate({
        target: [
          gstRateMappings.organizationId,
          gstRateMappings.kind,
          gstRateMappings.key,
        ],
        set: {
          label: m.label,
          hsnSac: m.hsnSac,
          gstRateBps: m.gstRateBps,
          revenueAccountId: m.revenueAccountId,
        },
      })
      .returning(mappingColumns),
    db.insert(auditLog).values({
      organizationId: ctx.orgId,
      actorId: ctx.userId,
      action: "gst_rate_mapping.upsert",
      entity: "gst_rate_mapping",
      entityId: `${m.kind}:${m.key}`,
      before: null,
      after: m,
      source: "web",
    }),
  ])
  if (!saved) throw new ServiceError("CONFLICT", "Couldn't save the mapping.")
  return saved
}
