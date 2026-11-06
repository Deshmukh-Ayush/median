import { describe, expect, it } from "vitest"

import {
  GST_SLAB_PERIODS,
  effectiveWindowSchema,
  gstSlabsOn,
  hsnSacCodeSchema,
  hsnSacKindOf,
  hsnSacRateImportRowSchema,
  isStandardGstSlab,
} from "./gst-rates"

describe("GST slabs", () => {
  it("are 0/5/12/18/28 up to 21 Sep 2025 and 0/5/18/40 from 22 Sep 2025", () => {
    expect(gstSlabsOn("2025-09-21")).toEqual([0, 500, 1200, 1800, 2800])
    expect(gstSlabsOn("2017-07-01")).toEqual([0, 500, 1200, 1800, 2800])
    expect(gstSlabsOn("2025-09-22")).toEqual([0, 500, 1800, 4000])
    expect(gstSlabsOn("2026-11-07")).toEqual([0, 500, 1800, 4000])
  })

  it("flags rates off the slabs for the supply date", () => {
    expect(isStandardGstSlab(1200, "2025-09-21")).toBe(true)
    expect(isStandardGstSlab(1200, "2025-09-22")).toBe(false)
    expect(isStandardGstSlab(4000, "2025-09-21")).toBe(false)
    expect(isStandardGstSlab(4000, "2025-09-22")).toBe(true)
  })

  it("periods are contiguous with no gaps or overlaps", () => {
    const [first, second] = GST_SLAB_PERIODS
    expect(GST_SLAB_PERIODS).toHaveLength(2)
    expect(first?.effectiveFrom).toBeNull()
    expect(second?.effectiveTo).toBeNull()
    const dayAfter = new Date(`${first?.effectiveTo ?? ""}T00:00:00Z`)
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1)
    expect(dayAfter.toISOString().slice(0, 10)).toBe(second?.effectiveFrom)
  })
})

describe("HSN/SAC", () => {
  it("accepts 2/4/6/8-digit codes and tells SAC from HSN", () => {
    expect(hsnSacCodeSchema.safeParse("9983").success).toBe(true)
    expect(hsnSacCodeSchema.safeParse("998314").success).toBe(true)
    expect(hsnSacCodeSchema.safeParse("12345").success).toBe(false)
    expect(hsnSacCodeSchema.safeParse("12AB").success).toBe(false)
    expect(hsnSacKindOf("998314")).toBe("sac")
    expect(hsnSacKindOf("8471")).toBe("hsn")
  })

  it("import rows need a source and an ordered window", () => {
    const row = {
      code: "8471",
      description: "Test heading",
      rateBps: 1800,
      effectiveFrom: "2025-09-22",
      effectiveTo: null,
      condition: null,
      source: "Test notification",
    }
    expect(hsnSacRateImportRowSchema.safeParse(row).success).toBe(true)
    expect(
      hsnSacRateImportRowSchema.safeParse({ ...row, source: "" }).success
    ).toBe(false)
    expect(
      hsnSacRateImportRowSchema.safeParse({ ...row, effectiveTo: "2025-01-01" })
        .success
    ).toBe(false)
  })

  it("effective windows reject end before start", () => {
    expect(
      effectiveWindowSchema.safeParse({
        effectiveFrom: "2025-09-22",
        effectiveTo: "2025-09-21",
      }).success
    ).toBe(false)
  })
})
