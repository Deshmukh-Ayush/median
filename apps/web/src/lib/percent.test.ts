import { describe, expect, it } from "vitest"

import { bpsToPercentText, percentTextSchema } from "./percent"

describe("percentTextSchema", () => {
  it.each([
    ["18", 1800],
    ["1.5", 150],
    ["0.25", 25],
    [" 5 ", 500],
    ["0", 0],
  ])("parses %s as %d bps", (text, bps) => {
    expect(percentTextSchema.parse(text)).toBe(bps)
  })

  it.each(["", "abc", "1.234", "-5", "1,5"])("rejects %j", (text) => {
    expect(percentTextSchema.safeParse(text).success).toBe(false)
  })
})

describe("bpsToPercentText", () => {
  it.each([
    [1800, "18"],
    [150, "1.5"],
    [25, "0.25"],
    [0, "0"],
    [1205, "12.05"],
  ])("formats %d as %s", (bps, text) => {
    expect(bpsToPercentText(bps)).toBe(text)
  })

  it("round-trips through the parser", () => {
    for (const bps of [0, 1, 10, 99, 250, 1800, 2800, 10_000]) {
      expect(percentTextSchema.parse(bpsToPercentText(bps))).toBe(bps)
    }
  })
})
