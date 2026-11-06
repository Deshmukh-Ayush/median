import { describe, expect, it } from "vitest"

import { computeLine, splitInclusive } from "./gst"
import {
  assertValidWindow,
  isEffectiveOn,
  rateOn,
  resolveGstRate,
  windowsOverlap,
} from "./gst-rates"
import type { EffectiveRate } from "./gst-rates"
import { paise } from "./money"

// A product whose rate moved from 12% to 5% in the 22 Sep 2025 revision.
const mapping: readonly EffectiveRate[] = [
  { rateBps: 1200, effectiveFrom: null, effectiveTo: "2025-09-21" },
  { rateBps: 500, effectiveFrom: "2025-09-22", effectiveTo: null },
]
const BEFORE = "2025-09-21"
const AFTER = "2025-09-22"

describe("effective windows", () => {
  it("are inclusive on both ends, with open bounds", () => {
    const w = { effectiveFrom: "2025-04-01", effectiveTo: "2025-09-21" }
    expect(isEffectiveOn(w, "2025-04-01")).toBe(true)
    expect(isEffectiveOn(w, "2025-09-21")).toBe(true)
    expect(isEffectiveOn(w, "2025-03-31")).toBe(false)
    expect(isEffectiveOn(w, "2025-09-22")).toBe(false)
    expect(
      isEffectiveOn({ effectiveFrom: null, effectiveTo: null }, "2017-07-01")
    ).toBe(true)
  })

  it("rejects bad dates and reversed windows", () => {
    expect(() =>
      isEffectiveOn({ effectiveFrom: null, effectiveTo: null }, "22-09-2025")
    ).toThrow(RangeError)
    expect(() =>
      assertValidWindow({ effectiveFrom: AFTER, effectiveTo: BEFORE })
    ).toThrow(RangeError)
    expect(() =>
      assertValidWindow({ effectiveFrom: BEFORE, effectiveTo: BEFORE })
    ).not.toThrow()
  })

  it("detect overlap, including touching days", () => {
    const [old, revised] = mapping
    if (!old || !revised) throw new Error("fixture")
    expect(windowsOverlap(old, revised)).toBe(false)
    expect(
      windowsOverlap(old, { effectiveFrom: BEFORE, effectiveTo: null })
    ).toBe(true)
    expect(
      windowsOverlap(
        { effectiveFrom: null, effectiveTo: null },
        { effectiveFrom: AFTER, effectiveTo: AFTER }
      )
    ).toBe(true)
  })
})

describe("rateOn", () => {
  it("picks the rate valid on the supply date, before and after 22 Sep 2025", () => {
    expect(rateOn(mapping, BEFORE)).toMatchObject({
      status: "found",
      rate: { rateBps: 1200 },
    })
    expect(rateOn(mapping, AFTER)).toMatchObject({
      status: "found",
      rate: { rateBps: 500 },
    })
  })

  it("reports no rate and conflicting rates instead of guessing", () => {
    expect(
      rateOn(
        [{ rateBps: 1800, effectiveFrom: AFTER, effectiveTo: null }],
        BEFORE
      )
    ).toEqual({ status: "none" })
    const conflicting = [
      ...mapping,
      { rateBps: 1800, effectiveFrom: AFTER, effectiveTo: null },
    ]
    expect(rateOn(conflicting, AFTER).status).toBe("ambiguous")
    expect(rateOn(conflicting, BEFORE).status).toBe("found")
  })
})

describe("resolveGstRate (rule 8)", () => {
  const base = { gstRegistered: true, mappingRates: mapping }

  it("uses the mapping rate valid on the supply date", () => {
    expect(resolveGstRate({ ...base, supplyDate: BEFORE })).toEqual({
      status: "found",
      rateBps: 1200,
      source: "mapping",
    })
    expect(resolveGstRate({ ...base, supplyDate: AFTER })).toEqual({
      status: "found",
      rateBps: 500,
      source: "mapping",
    })
  })

  it("splits the same inclusive amount differently either side of the change", () => {
    const amount = paise(11_200n)
    const rate = (supplyDate: string) => {
      const r = resolveGstRate({ ...base, supplyDate })
      if (r.status !== "found") throw new Error("expected a rate")
      return r.rateBps
    }
    expect(splitInclusive(amount, rate(BEFORE))).toEqual({
      taxable: paise(10_000n),
      gst: paise(1_200n),
    })
    expect(splitInclusive(amount, rate(AFTER))).toEqual({
      taxable: paise(10_667n),
      gst: paise(533n),
    })
    // Line tax on a 100.00 sale: 12% before, 5% after.
    const line = (supplyDate: string) =>
      computeLine(
        {
          quantityMilli: 1000n,
          unitPrice: paise(10_000n),
          rateBps: rate(supplyDate),
        },
        { intrastate: true, chargesGst: true }
      )
    expect(line(BEFORE)).toMatchObject({ cgst: paise(600n), sgst: paise(600n) })
    expect(line(AFTER)).toMatchObject({ cgst: paise(250n), sgst: paise(250n) })
  })

  it("prefers line rates, then mapping, then the dated org default", () => {
    const orgDefaultRates: EffectiveRate[] = [
      { rateBps: 1800, effectiveFrom: null, effectiveTo: "2025-09-21" },
      { rateBps: 4000, effectiveFrom: AFTER, effectiveTo: null },
    ]
    expect(
      resolveGstRate({
        ...base,
        supplyDate: AFTER,
        lineRatesBps: [1800, 1800],
        orgDefaultRates,
      })
    ).toEqual({ status: "found", rateBps: 1800, source: "line" })
    expect(
      resolveGstRate({
        gstRegistered: true,
        supplyDate: BEFORE,
        orgDefaultRates,
      })
    ).toEqual({ status: "found", rateBps: 1800, source: "org_default" })
    expect(
      resolveGstRate({
        gstRegistered: true,
        supplyDate: AFTER,
        orgDefaultRates,
      })
    ).toEqual({ status: "found", rateBps: 4000, source: "org_default" })
  })

  it("falls through a mapping with no window for that date", () => {
    expect(
      resolveGstRate({
        gstRegistered: true,
        supplyDate: BEFORE,
        mappingRates: [
          { rateBps: 500, effectiveFrom: AFTER, effectiveTo: null },
        ],
        orgDefaultRates: [
          { rateBps: 1800, effectiveFrom: null, effectiveTo: null },
        ],
      })
    ).toEqual({ status: "found", rateBps: 1800, source: "org_default" })
  })

  it("sends mixed line rates, conflicts and missing rates to the inbox", () => {
    expect(
      resolveGstRate({ ...base, supplyDate: AFTER, lineRatesBps: [500, 1800] })
    ).toEqual({ status: "inbox", reason: "ambiguous", source: "line" })
    expect(resolveGstRate({ gstRegistered: true, supplyDate: AFTER })).toEqual({
      status: "inbox",
      reason: "no_rate",
      source: null,
    })
    expect(
      resolveGstRate({
        gstRegistered: true,
        supplyDate: AFTER,
        mappingRates: [
          { rateBps: 500, effectiveFrom: null, effectiveTo: null },
          { rateBps: 1800, effectiveFrom: AFTER, effectiveTo: null },
        ],
        orgDefaultRates: [
          { rateBps: 1800, effectiveFrom: null, effectiveTo: null },
        ],
      })
    ).toEqual({ status: "inbox", reason: "ambiguous", source: "mapping" })
  })

  it("doesn't split for unregistered orgs", () => {
    expect(
      resolveGstRate({ ...base, gstRegistered: false, supplyDate: AFTER })
    ).toEqual({ status: "not_registered" })
  })
})
