import { describe, expect, it } from "vitest"

import { can, whoCan } from "./permissions"

describe("whoCan", () => {
  it("lists every role holding the permission, in a sentence", () => {
    const lockers = whoCan({ resource: "period", action: "lock" })
    expect(lockers.startsWith("owners")).toBe(true)
    // Follows the permission table, whatever it says about CAs.
    expect(lockers.includes("CAs")).toBe(
      can("ca", { resource: "period", action: "lock" })
    )
  })

  it("names a single role on its own", () => {
    expect(whoCan({ resource: "period", action: "unlock" })).toBe("owners")
  })
})
