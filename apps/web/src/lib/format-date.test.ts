import { describe, expect, it } from "vitest"

import { formatDate, formatDateTime, formatPeriod } from "@/lib/format-date"

describe("formatPeriod", () => {
  it.each([
    ["2026-11", "November 2026"],
    ["2027-01", "January 2027"],
    ["2026-12", "December 2026"],
  ])("formats %s as %s", (period, expected) => {
    expect(formatPeriod(period)).toBe(expected)
  })

  it.each(["2026-13", "2026-00", "Nov 2026", ""])(
    "returns %j unchanged when it isn't a period",
    (period) => {
      expect(formatPeriod(period)).toBe(period)
    }
  )
})

describe("formatDateTime", () => {
  it("shows the time in IST", () => {
    // 11:12 UTC is 16:42 IST.
    expect(formatDateTime("2026-11-05T11:12:00.000Z")).toMatch(
      /^5 Nov,? 4:42 pm$/
    )
  })

  it("crosses midnight into the next IST day", () => {
    expect(formatDateTime("2026-11-05T19:00:00.000Z")).toMatch(
      /^6 Nov,? 12:30 am$/
    )
  })

  it("returns invalid input unchanged", () => {
    expect(formatDateTime("not a date")).toBe("not a date")
  })
})

describe("formatDate", () => {
  it("formats an ISO date without shifting the day", () => {
    expect(formatDate("2026-11-05")).toBe("5 Nov 2026")
    expect(formatDate("2026-01-31")).toBe("31 Jan 2026")
  })

  it.each(["2026-02-30", "05/11/2026", ""])("returns %j unchanged", (value) => {
    expect(formatDate(value)).toBe(value)
  })
})
