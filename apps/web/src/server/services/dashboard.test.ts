import { describe, expect, it } from "vitest"

import { dashboardMonths } from "./dashboard"

describe("dashboardMonths", () => {
  it("covers this month so far and all of last month", () => {
    expect(dashboardMonths("2026-11-10")).toEqual({
      period: "2026-11",
      thisMonth: { from: "2026-11-01", to: "2026-11-10" },
      lastMonth: { from: "2026-10-01", to: "2026-10-31" },
    })
  })

  it("handles January and leap years", () => {
    expect(dashboardMonths("2027-01-05").lastMonth).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    })
    expect(dashboardMonths("2028-03-01").lastMonth.to).toBe("2028-02-29")
  })
})
