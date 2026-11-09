import { describe, expect, it } from "vitest"

import {
  addMonths,
  daysUntil,
  gstDeadlines,
  periodParam,
} from "./gst-deadlines"

const regular = { gstRegistered: true, compositionScheme: false }
const composition = { gstRegistered: true, compositionScheme: true }

describe("addMonths", () => {
  it.each([
    ["2026-10", 1, "2026-11"],
    ["2026-12", 1, "2027-01"],
    ["2027-01", -1, "2026-12"],
    ["2026-03", 12, "2027-03"],
  ] as const)("%s + %d = %s", (p, n, want) => {
    expect(addMonths(p, n)).toBe(want)
  })
})

describe("gstDeadlines", () => {
  it("gives monthly filers GSTR-1 on the 11th and GSTR-3B on the 20th", () => {
    expect(gstDeadlines("2026-10", regular)).toEqual([
      expect.objectContaining({ form: "GSTR-1", due: "2026-11-11" }),
      expect.objectContaining({ form: "GSTR-3B", due: "2026-11-20" }),
    ])
    expect(gstDeadlines("2026-12", regular)[1]?.due).toBe("2027-01-20")
  })

  it.each([
    ["2026-04", "2026-07-18"],
    ["2026-06", "2026-07-18"],
    ["2026-08", "2026-10-18"],
    ["2026-12", "2027-01-18"],
    ["2027-02", "2027-04-18"],
  ] as const)("composition: %s → CMP-08 due %s", (p, due) => {
    expect(gstDeadlines(p, composition)[0]).toMatchObject({
      form: "CMP-08",
      due,
    })
  })

  it("adds GSTR-4 in the last quarter of the financial year", () => {
    expect(gstDeadlines("2027-03", composition).map((d) => d.form)).toEqual([
      "CMP-08",
      "GSTR-4",
    ])
    expect(gstDeadlines("2027-03", composition)[1]?.due).toBe("2027-04-30")
    expect(gstDeadlines("2026-11", composition)).toHaveLength(1)
  })

  it("has nothing for unregistered businesses", () => {
    expect(
      gstDeadlines("2026-10", {
        gstRegistered: false,
        compositionScheme: false,
      })
    ).toEqual([])
  })
})

describe("helpers", () => {
  it("counts days", () => {
    expect(daysUntil("2026-11-10", "2026-11-20")).toBe(10)
    expect(daysUntil("2026-11-10", "2026-11-10")).toBe(0)
    expect(daysUntil("2026-11-12", "2026-11-11")).toBe(-1)
  })

  it("parses periods", () => {
    expect(periodParam("2026-10")).toBe("2026-10")
    expect(periodParam("2026-13")).toBeUndefined()
    expect(periodParam(undefined)).toBeUndefined()
  })
})
