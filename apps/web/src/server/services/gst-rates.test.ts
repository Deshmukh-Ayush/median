import type { HsnSacRate } from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import { parseHsnSacRatesCsv } from "../db/hsn-sac-import"
import { hsnSacAncestors, pickHsnSacRate } from "./gst-rates"

// Fixture codes and rates only; not real notification data.
const codes = [
  { code: "0000", description: "Test heading" },
  { code: "00001111", description: "Test tariff item" },
]
const rate = (r: Partial<HsnSacRate> & Pick<HsnSacRate, "rateBps">) => ({
  code: "0000",
  effectiveFrom: "2017-07-01",
  effectiveTo: null,
  condition: null,
  source: "fixture",
  ...r,
})
const BEFORE = "2025-09-21"
const AFTER = "2025-09-22"

describe("HSN/SAC lookup", () => {
  it("walks up parent headings", () => {
    expect(hsnSacAncestors("84713010")).toEqual([
      "84713010",
      "847130",
      "8471",
      "84",
    ])
  })

  it("picks the rate valid on the supply date, before and after 22 Sep 2025", () => {
    const rates = [
      rate({ rateBps: 1200, effectiveTo: BEFORE }),
      rate({ rateBps: 500, effectiveFrom: AFTER }),
    ]
    expect(pickHsnSacRate("00001111", BEFORE, codes, rates)).toMatchObject({
      status: "found",
      code: "0000",
      rate: { rateBps: 1200 },
    })
    expect(pickHsnSacRate("00001111", AFTER, codes, rates)).toMatchObject({
      status: "found",
      rate: { rateBps: 500 },
    })
  })

  it("prefers the most specific code with a rate that day", () => {
    const rates = [
      rate({ rateBps: 1800 }),
      rate({ code: "00001111", rateBps: 500, effectiveFrom: AFTER }),
    ]
    expect(pickHsnSacRate("00001111", AFTER, codes, rates)).toMatchObject({
      code: "00001111",
      rate: { rateBps: 500 },
    })
    // Before the specific rate starts, the heading's rate applies.
    expect(pickHsnSacRate("00001111", BEFORE, codes, rates)).toMatchObject({
      code: "0000",
      rate: { rateBps: 1800 },
    })
  })

  it("returns conditional rates for the user to pick, never guessing", () => {
    const rates = [
      rate({ rateBps: 500, condition: "up to ₹2,500" }),
      rate({ rateBps: 1800, condition: "over ₹2,500" }),
    ]
    const result = pickHsnSacRate("0000", AFTER, codes, rates)
    expect(result.status).toBe("conditional")
    if (result.status === "conditional") expect(result.rates).toHaveLength(2)
  })

  it("says when a code is unknown or has no rate that day", () => {
    expect(pickHsnSacRate("9983", AFTER, codes, [])).toEqual({
      status: "unknown_code",
      code: "9983",
    })
    expect(
      pickHsnSacRate("00001111", BEFORE, codes, [
        rate({ rateBps: 500, effectiveFrom: AFTER }),
      ])
    ).toEqual({ status: "no_rate", code: "00001111" })
  })
})

describe("HSN/SAC rate file", () => {
  const header =
    "code,description,rate_bps,effective_from,effective_to,condition,source\n"

  it("ships empty: rates are never invented", async () => {
    const { readFileSync } = await import("node:fs")
    const text = readFileSync(
      new URL("../../../data/hsn-sac-rates.csv", import.meta.url),
      "utf8"
    )
    expect(parseHsnSacRatesCsv(text)).toEqual({ rows: [], errors: [] })
  })

  it("parses rows and blank optional fields", () => {
    const { rows, errors } = parseHsnSacRatesCsv(
      `${header}0000,Test,1200,2017-07-01,2025-09-21,,fixture\n0000,Test,500,2025-09-22,,,fixture\n`
    )
    expect(errors).toEqual([])
    expect(rows).toEqual([
      expect.objectContaining({ rateBps: 1200, effectiveTo: BEFORE }),
      expect.objectContaining({
        rateBps: 500,
        effectiveTo: null,
        condition: null,
      }),
    ])
  })

  it("rejects missing columns, bad rows and overlapping windows", () => {
    expect(parseHsnSacRatesCsv("code,rate_bps\n").errors[0]?.message).toMatch(
      /Missing columns/
    )
    const { errors } = parseHsnSacRatesCsv(
      `${header}0000,Test,12.5,2017-07-01,,,fixture\n0000,Test,1200,2017-07-01,,,\n0000,Test,1200,2017-07-01,,,fixture\n0000,Test,500,2025-09-22,,,fixture\n`
    )
    expect(errors.map((e) => e.line)).toEqual([2, 3, 5])
  })
})
