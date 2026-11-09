import { describe, expect, it } from "vitest"

import {
  dateParam,
  financialYearStart,
  firstParam,
  idParam,
  journalHref,
  sourceParam,
  trialBalanceHref,
} from "./report-params"

const ID = "00000000-0000-4000-8000-000000001001"

describe("search params", () => {
  it("takes the first, trimmed value", () => {
    expect(firstParam([" a ", "b"])).toBe("a")
    expect(firstParam("  ")).toBeUndefined()
    expect(firstParam(undefined)).toBeUndefined()
  })

  it("keeps only valid dates", () => {
    expect(dateParam("2026-04-01")).toBe("2026-04-01")
    expect(dateParam("2026-02-30")).toBeUndefined()
    expect(dateParam("yesterday")).toBeUndefined()
  })

  it("keeps only UUIDs", () => {
    expect(idParam(ID)).toBe(ID)
    expect(idParam("1110")).toBeUndefined()
  })

  it("keeps only known sources", () => {
    expect(sourceParam("razorpay")).toBe("razorpay")
    expect(sourceParam("toString")).toBeUndefined()
    expect(sourceParam("other")).toBeUndefined()
  })
})

describe("financialYearStart", () => {
  it.each([
    ["2026-11-10", "2026-04-01"],
    ["2026-04-01", "2026-04-01"],
    ["2026-03-31", "2025-04-01"],
    ["2027-01-15", "2026-04-01"],
  ])("%s is in the year starting %s", (date, start) => {
    expect(financialYearStart(date)).toBe(start)
  })
})

describe("journalHref", () => {
  it("is plain /ledger without filters", () => {
    expect(journalHref()).toBe("/ledger")
  })

  it("encodes filters", () => {
    expect(
      journalHref({ accountId: ID, from: "2026-04-01", to: "2026-11-10" })
    ).toBe(`/ledger?account=${ID}&from=2026-04-01&to=2026-11-10`)
    expect(journalHref({ q: "rent & power", cursor: "a+b" })).toBe(
      "/ledger?q=rent+%26+power&cursor=a%2Bb"
    )
  })

  it("links the trial balance", () => {
    expect(trialBalanceHref("2026-11-10")).toBe(
      "/ledger?view=trial-balance&asOf=2026-11-10"
    )
  })
})
