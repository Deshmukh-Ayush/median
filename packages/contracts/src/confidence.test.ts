import { describe, expect, it } from "vitest"

import { CONFIDENCE_HIGH, CONFIDENCE_MEDIUM } from "./confidence"

describe("confidence thresholds", () => {
  it("are ordered within 0–1", () => {
    expect(CONFIDENCE_HIGH).toBe(0.9)
    expect(CONFIDENCE_MEDIUM).toBe(0.7)
    expect(0 < CONFIDENCE_MEDIUM && CONFIDENCE_MEDIUM < CONFIDENCE_HIGH).toBe(
      true
    )
    expect(CONFIDENCE_HIGH <= 1).toBe(true)
  })
})
