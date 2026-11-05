import { describe, expect, it } from "vitest"
import { CONFIDENCE_HIGH, CONFIDENCE_MEDIUM } from "@workspace/contracts"

import { confidenceLevel } from "@workspace/ui/components/confidence-badge"

describe("confidenceLevel", () => {
  it("uses the shared contract thresholds", () => {
    expect(confidenceLevel(CONFIDENCE_HIGH)).toBe("high")
    expect(confidenceLevel(CONFIDENCE_HIGH - 0.001)).toBe("medium")
    expect(confidenceLevel(CONFIDENCE_MEDIUM)).toBe("medium")
    expect(confidenceLevel(CONFIDENCE_MEDIUM - 0.001)).toBe("low")
    expect(confidenceLevel(0)).toBe("low")
  })
})
