import "server-only"

import {
  ServiceError,
  findGstRateInputSchema,
  hsnSacKindOf,
  isStandardGstSlab,
  lookupHsnSacRateInputSchema,
  parseInput,
  setOrgDefaultGstRateInputSchema,
} from "@workspace/contracts"
import type {
  FindGstRateInput,
  FindGstRateResult,
  HsnSacRate,
  HsnSacRateLookup,
  IsoDate,
  LookupHsnSacRateInput,
  OrgDefaultGstRate,
  SetOrgDefaultGstRateInput,
} from "@workspace/contracts"
import { isEffectiveOn, resolveGstRate } from "@workspace/ledger"
import type { EffectiveRate } from "@workspace/ledger"
import { and, asc, eq, inArray, sql } from "drizzle-orm"

import { getDb, withTransaction } from "../db"
import {
  auditLog,
  gstRateMappings,
  hsnSacCodes,
  hsnSacRates,
  organizationDefaultGstRates,
  organizationSettings,
} from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"

// Effective-dated GST rates: HSN/SAC master lookup, the rule-8 rate for
// GST-inclusive amounts on a supply date, and the org's dated default rate.

/** "84713010" → ["84713010", "847130", "8471", "84"]: the code and its parents. */
export function hsnSacAncestors(code: string): string[] {
  const codes: string[] = []
  for (let len = code.length; len >= 2; len -= 2) codes.push(code.slice(0, len))
  return codes
}

interface MasterCode {
  readonly code: string
  readonly description: string
}

/**
 * Picks the rate for `requested` on `onDate` from master rows for the code
 * and its parent headings: the most specific code with a rate valid that day
 * wins. Several valid rates (conditional rates) are returned for the user to
 * choose; never guessed. Pure, for tests.
 */
export function pickHsnSacRate(
  requested: string,
  onDate: IsoDate,
  codes: readonly MasterCode[],
  rates: readonly HsnSacRate[]
): HsnSacRateLookup {
  const byCode = new Map(codes.map((c) => [c.code, c]))
  const known = hsnSacAncestors(requested).filter((c) => byCode.has(c))
  const [mostSpecific] = known
  if (mostSpecific === undefined)
    return { status: "unknown_code", code: requested }
  for (const code of known) {
    const valid = rates.filter(
      (r) => r.code === code && isEffectiveOn(r, onDate)
    )
    const [only] = valid
    const master = byCode.get(code)
    if (!only || !master) continue
    const base = {
      code,
      kind: hsnSacKindOf(code),
      description: master.description,
    }
    return valid.length === 1
      ? { status: "found", ...base, rate: only }
      : { status: "conditional", ...base, rates: valid }
  }
  return { status: "no_rate", code: mostSpecific }
}

/**
 * The GST rate for an HSN/SAC code on a supply date, from the HSN/SAC master
 * (falls back to parent headings). The master is reference data filled only
 * from official notifications; an empty master answers "unknown_code".
 */
export async function lookupHsnSacRate(
  ctx: OrgContext,
  input: LookupHsnSacRateInput
): Promise<HsnSacRateLookup> {
  assertCan(ctx, "ledger", "read")
  const { code, onDate } = parseInput(lookupHsnSacRateInputSchema, input)
  const ancestors = hsnSacAncestors(code)
  const db = getDb()
  const [codes, rates] = await db.batch([
    db
      .select({ code: hsnSacCodes.code, description: hsnSacCodes.description })
      .from(hsnSacCodes)
      .where(inArray(hsnSacCodes.code, ancestors)),
    db
      .select({
        code: hsnSacRates.code,
        rateBps: hsnSacRates.gstRateBps,
        effectiveFrom: hsnSacRates.effectiveFrom,
        effectiveTo: hsnSacRates.effectiveTo,
        condition: hsnSacRates.condition,
        source: hsnSacRates.source,
      })
      .from(hsnSacRates)
      .where(inArray(hsnSacRates.code, ancestors)),
  ])
  return pickHsnSacRate(code, onDate, codes, rates)
}

/** The org default rate history; falls back to the undated settings value. */
async function orgDefaultRates(orgId: string): Promise<EffectiveRate[]> {
  const db = getDb()
  const [history, settings] = await db.batch([
    db
      .select({
        rateBps: organizationDefaultGstRates.gstRateBps,
        effectiveFrom: organizationDefaultGstRates.effectiveFrom,
        effectiveTo: organizationDefaultGstRates.effectiveTo,
      })
      .from(organizationDefaultGstRates)
      .where(eq(organizationDefaultGstRates.organizationId, orgId)),
    db
      .select({ rateBps: organizationSettings.defaultGstRateBps })
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, orgId))
      .limit(1),
  ])
  if (history.length > 0) return history
  const rate = settings[0]?.rateBps
  return rate === null || rate === undefined
    ? []
    : [{ rateBps: rate, effectiveFrom: null, effectiveTo: null }]
}

/**
 * Rule 8: the GST rate for a GST-inclusive amount on its supply date —
 * invoice/order lines → product/stream mapping → org default → inbox. Rates
 * off the standard slabs for that date come back with a warning.
 */
export async function findGstRate(
  ctx: OrgContext,
  input: FindGstRateInput
): Promise<FindGstRateResult> {
  assertCan(ctx, "ledger", "read")
  const i = parseInput(findGstRateInputSchema, input)
  const db = getDb()
  const [settings] = await db
    .select({ gstRegistered: organizationSettings.gstRegistered })
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, ctx.orgId))
    .limit(1)

  const mappingRates = i.mapping
    ? await db
        .select({
          rateBps: gstRateMappings.gstRateBps,
          effectiveFrom: gstRateMappings.effectiveFrom,
          effectiveTo: gstRateMappings.effectiveTo,
        })
        .from(gstRateMappings)
        .where(
          and(
            eq(gstRateMappings.organizationId, ctx.orgId),
            eq(gstRateMappings.kind, i.mapping.kind),
            eq(gstRateMappings.key, i.mapping.key)
          )
        )
    : []

  const resolved = resolveGstRate({
    supplyDate: i.supplyDate,
    gstRegistered: settings?.gstRegistered ?? false,
    lineRatesBps: i.lineRatesBps ?? [],
    mappingRates,
    orgDefaultRates: await orgDefaultRates(ctx.orgId),
  })
  if (resolved.status !== "found") return resolved
  return {
    ...resolved,
    warning: isStandardGstSlab(resolved.rateBps, i.supplyDate)
      ? null
      : `${resolved.rateBps / 100}% isn't a standard GST slab on ${i.supplyDate}. Check the rate.`,
  }
}

/** The org's default GST rate over time, newest first. */
export async function listOrgDefaultGstRates(
  ctx: OrgContext
): Promise<readonly OrgDefaultGstRate[]> {
  assertCan(ctx, "settings", "read")
  const rows = await getDb()
    .select({
      rateBps: organizationDefaultGstRates.gstRateBps,
      effectiveFrom: organizationDefaultGstRates.effectiveFrom,
      effectiveTo: organizationDefaultGstRates.effectiveTo,
    })
    .from(organizationDefaultGstRates)
    .where(eq(organizationDefaultGstRates.organizationId, ctx.orgId))
    .orderBy(sql`${organizationDefaultGstRates.effectiveFrom} desc nulls last`)
    .limit(500)
  if (rows.length > 0) return rows
  return orgDefaultRates(ctx.orgId)
}

function dayBefore(date: IsoDate): IsoDate {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Sets a new default GST rate from `effectiveFrom`, open-ended; the window
 * in force the day before ends then. History is kept, so payments before the
 * change still split at the old rate. Writes an audit row. Throws CONFLICT
 * if a later window already exists (change it from the latest one).
 */
export async function setOrgDefaultGstRate(
  ctx: OrgContext,
  input: SetOrgDefaultGstRateInput
): Promise<readonly OrgDefaultGstRate[]> {
  assertCan(ctx, "settings", "update")
  const { rateBps, effectiveFrom } = parseInput(
    setOrgDefaultGstRateInputSchema,
    input
  )
  await withTransaction(async (tx) => {
    const t = organizationDefaultGstRates
    // Serialise changes to one org's history.
    await tx
      .select({ id: organizationSettings.organizationId })
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, ctx.orgId))
      .for("update")
    const history = await tx
      .select({
        id: t.id,
        rateBps: t.gstRateBps,
        effectiveFrom: t.effectiveFrom,
        effectiveTo: t.effectiveTo,
      })
      .from(t)
      .where(eq(t.organizationId, ctx.orgId))
      .orderBy(asc(t.effectiveFrom))

    if (
      history.some(
        (r) => r.effectiveFrom !== null && r.effectiveFrom >= effectiveFrom
      )
    ) {
      throw new ServiceError(
        "CONFLICT",
        "A default rate already starts on or after that date."
      )
    }

    const before = history.map(
      ({ rateBps: r, effectiveFrom: f, effectiveTo: e }) => ({
        rateBps: r,
        effectiveFrom: f,
        effectiveTo: e,
      })
    )
    const end = dayBefore(effectiveFrom)
    const current = history.find((r) => isEffectiveOn(r, effectiveFrom))
    if (current) {
      await tx.update(t).set({ effectiveTo: end }).where(eq(t.id, current.id))
    } else if (history.length === 0) {
      // First dated change: keep the undated settings rate for earlier dates.
      const [settings] = await tx
        .select({ rateBps: organizationSettings.defaultGstRateBps })
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, ctx.orgId))
        .limit(1)
      if (settings?.rateBps !== null && settings?.rateBps !== undefined) {
        await tx.insert(t).values({
          organizationId: ctx.orgId,
          gstRateBps: settings.rateBps,
          effectiveFrom: null,
          effectiveTo: end,
          createdBy: ctx.userId,
        })
      }
    }
    await tx.insert(t).values({
      organizationId: ctx.orgId,
      gstRateBps: rateBps,
      effectiveFrom,
      effectiveTo: null,
      createdBy: ctx.userId,
    })
    await tx.insert(auditLog).values({
      organizationId: ctx.orgId,
      actorId: ctx.userId,
      action: "default_gst_rate.set",
      entity: "organization_default_gst_rate",
      entityId: effectiveFrom,
      before,
      after: { rateBps, effectiveFrom },
      source: "web",
    })
  })
  return listOrgDefaultGstRates(ctx)
}
