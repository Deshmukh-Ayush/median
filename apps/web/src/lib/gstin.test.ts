import { describe, expect, it } from "vitest"

import { gstinCheckChar, gstinProblem, isGstStateCode } from "./gstin"

describe("gstin", () => {
  // Synthetic GSTINs with correct check characters.
  it("accepts valid GSTINs", () => {
    expect(gstinProblem("29AAACL4417K1ZD")).toBeNull()
    expect(gstinProblem(" 27abhfs2093n1zl ")).toBeNull()
  })

  it("computes the check character", () => {
    expect(gstinCheckChar("29AAACL4417K1Z")).toBe("D")
    expect(gstinCheckChar("short")).toBeNull()
  })

  it("rejects a single misread character via the checksum", () => {
    expect(gstinProblem("29AAACL4417K1ZE")).toBe("checksum")
    expect(gstinProblem("29AAACL4411K1ZD")).toBe("checksum")
  })

  it("rejects bad format and unknown state codes", () => {
    expect(gstinProblem("29AAACL4417K1Z")).toBe("format")
    expect(gstinProblem("29AAACL4417K0ZD")).toBe("format")
    expect(gstinProblem("45AAACL4417K1ZD")).toBe("state")
  })

  it("knows the state codes", () => {
    expect(isGstStateCode("29")).toBe(true)
    expect(isGstStateCode("97")).toBe(true)
    expect(isGstStateCode("00")).toBe(false)
    expect(isGstStateCode("40")).toBe(false)
    expect(isGstStateCode("9")).toBe(false)
  })
})
