import { and, eq } from "drizzle-orm"
import { expect, it } from "vitest"
import { getDb } from "../src/server/db"
import {
  gstRateMappings,
  organizationDefaultGstRates,
  organizationSettings,
} from "../src/server/db/schema"
import {
  findGstRate,
  setOrgDefaultGstRate,
  listOrgDefaultGstRates,
} from "../src/server/services/gst-rates"
import {
  listGstRateMappings,
  upsertGstRateMapping,
} from "../src/server/services/gst-profile"
import { devOrg } from "./setup"

it("effective-dated mappings and defaults on the real DB", async () => {
  const ctx = await devOrg()
  const db = getDb()
  await db
    .delete(gstRateMappings)
    .where(
      and(
        eq(gstRateMappings.organizationId, ctx.orgId),
        eq(gstRateMappings.key, "devcheck-plan")
      )
    )
  await db
    .delete(organizationDefaultGstRates)
    .where(eq(organizationDefaultGstRates.organizationId, ctx.orgId))
  await db
    .update(organizationSettings)
    .set({
      gstRegistered: true,
      gstin: "29ABCDE1234F1Z5",
      stateCode: "29",
      defaultGstRateBps: 1800,
    })
    .where(eq(organizationSettings.organizationId, ctx.orgId))

  const base = {
    kind: "product",
    key: "devcheck-plan",
    label: "Plan",
    hsnSac: null,
    revenueAccountId: null,
  } as const
  await upsertGstRateMapping(ctx, { ...base, gstRateBps: 1200 })
  await upsertGstRateMapping(ctx, {
    ...base,
    gstRateBps: 1200,
    label: "Plan v2",
  })
  await upsertGstRateMapping(ctx, {
    ...base,
    gstRateBps: 500,
    effectiveFrom: "2025-09-22",
  })
  await expect(
    upsertGstRateMapping(ctx, { ...base, gstRateBps: 1800 })
  ).rejects.toThrow(/dated rates/)
  await expect(
    upsertGstRateMapping(ctx, {
      ...base,
      gstRateBps: 1800,
      effectiveFrom: "2025-09-01",
    })
  ).rejects.toThrow()
  const page = await listGstRateMappings(ctx, null, {}, { limit: 1 })
  const page2 = await listGstRateMappings(
    ctx,
    page.nextCursor,
    {},
    { limit: 1 }
  )
  expect(
    [...page.items, ...page2.items].map((m) => [
      m.gstRateBps,
      m.effectiveFrom,
      m.effectiveTo,
    ])
  ).toEqual([
    [1200, null, "2025-09-21"],
    [500, "2025-09-22", null],
  ])

  const mapping = { kind: "product", key: "devcheck-plan" } as const
  expect(
    await findGstRate(ctx, { supplyDate: "2025-09-21", mapping })
  ).toMatchObject({ status: "found", rateBps: 1200, source: "mapping" })
  expect(
    await findGstRate(ctx, { supplyDate: "2025-09-22", mapping })
  ).toMatchObject({ status: "found", rateBps: 500, warning: null })
  expect(await findGstRate(ctx, { supplyDate: "2025-09-22" })).toMatchObject({
    rateBps: 1800,
    source: "org_default",
  })

  await setOrgDefaultGstRate(ctx, {
    rateBps: 4000,
    effectiveFrom: "2025-09-22",
  })
  expect(await listOrgDefaultGstRates(ctx)).toEqual([
    { rateBps: 4000, effectiveFrom: "2025-09-22", effectiveTo: null },
    { rateBps: 1800, effectiveFrom: null, effectiveTo: "2025-09-21" },
  ])
  expect(await findGstRate(ctx, { supplyDate: "2025-09-21" })).toMatchObject({
    rateBps: 1800,
  })
  expect(await findGstRate(ctx, { supplyDate: "2025-09-22" })).toMatchObject({
    rateBps: 4000,
  })
})
