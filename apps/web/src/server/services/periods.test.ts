import { describe, expect, it } from "vitest"

import { currentPeriodIst } from "./periods"

describe("currentPeriodIst", () => {
  it("rolls over at midnight IST, not UTC", () => {
    expect(currentPeriodIst(new Date("2026-11-30T18:29:59Z"))).toBe("2026-11")
    expect(currentPeriodIst(new Date("2026-11-30T18:30:00Z"))).toBe("2026-12")
  })
})
