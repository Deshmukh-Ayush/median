import { describe, expect, it } from "vitest"

import { updateGstProfileInputSchema } from "./gst-profile"
import { GST_STATES, gstStateByCode, isActiveGstStateCode } from "./gst-states"

const profile = {
  legalName: "Acme Retail Pvt Ltd",
  gstin: "29AABCA1234F1Z5",
  stateCode: "29",
  gstRegistered: true,
  compositionScheme: false,
  defaultGstRateBps: 1800,
}

describe("GST states", () => {
  it("has unique two-digit codes", () => {
    const codes = GST_STATES.map((s) => s.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes.every((c) => /^\d{2}$/.test(c))).toBe(true)
  })

  it("marks UTGST territories and retired codes", () => {
    expect(gstStateByCode("04")?.intrastateTax).toBe("UTGST")
    expect(gstStateByCode("07")?.intrastateTax).toBe("SGST")
    expect(isActiveGstStateCode("37")).toBe(true)
    expect(isActiveGstStateCode("28")).toBe(false)
    expect(isActiveGstStateCode("99")).toBe(false)
  })
})

describe("updateGstProfileInputSchema", () => {
  it("accepts a registered profile", () => {
    expect(updateGstProfileInputSchema.safeParse(profile).success).toBe(true)
  })

  it("needs a GSTIN when registered, and registration for composition", () => {
    expect(
      updateGstProfileInputSchema.safeParse({ ...profile, gstin: null }).success
    ).toBe(false)
    expect(
      updateGstProfileInputSchema.safeParse({
        ...profile,
        gstin: null,
        gstRegistered: false,
        compositionScheme: true,
      }).success
    ).toBe(false)
  })

  it("rejects a state code that isn't a GST state or doesn't match the GSTIN", () => {
    expect(
      updateGstProfileInputSchema.safeParse({ ...profile, stateCode: "99" })
        .success
    ).toBe(false)
    expect(
      updateGstProfileInputSchema.safeParse({ ...profile, stateCode: "27" })
        .success
    ).toBe(false)
  })
})
