import { describe, expect, it } from "vitest"

import { isExport, specialSupplyOf, supplyLabel } from "./invoices"

describe("specialSupplyOf", () => {
  it.each([
    ["export_lut", "export_lut"],
    ["export_with_payment", "export_with_payment"],
    ["sez", "sez"],
    ["", null],
    ["intrastate", null],
    ["toString", null],
  ])("%j → %j", (value, expected) => {
    expect(specialSupplyOf(value)).toBe(expected)
  })

  it("knows which are exports", () => {
    expect(isExport("export_lut")).toBe(true)
    expect(isExport("export_with_payment")).toBe(true)
    expect(isExport("sez")).toBe(false)
    expect(isExport(null)).toBe(false)
  })
})

describe("supplyLabel", () => {
  it.each(["export_with_payment", "export_lut", "sez"] as const)(
    "never calls %s plain inter-state",
    (t) => {
      expect(supplyLabel(t)).not.toMatch(/inter-state/i)
    }
  )

  it("names exports, LUT and SEZ", () => {
    expect(supplyLabel("export_lut")).toContain("LUT")
    expect(supplyLabel("sez")).toContain("SEZ")
    expect(supplyLabel("export_with_payment")).toContain("Export")
    expect(supplyLabel("intrastate")).toBe("Intra-state (CGST + SGST)")
  })
})
