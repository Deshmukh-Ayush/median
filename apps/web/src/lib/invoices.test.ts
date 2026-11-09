import { describe, expect, it } from "vitest"

import { isExport, specialSupplyOf } from "./invoices"

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
