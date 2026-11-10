import { describe, expect, it } from "vitest"

import { roles } from "./permissions"
import type { OrgRole } from "./permissions"

function allows(role: OrgRole, action: "lock" | "unlock"): boolean {
  return roles[role].authorize({ period: [action] }).success
}

describe("period permissions", () => {
  it("lets owners, finance and CAs lock a month", () => {
    expect(allows("owner", "lock")).toBe(true)
    expect(allows("finance", "lock")).toBe(true)
    expect(allows("ca", "lock")).toBe(true)
    expect(allows("investor", "lock")).toBe(false)
  })

  it("keeps unlocking with the owner", () => {
    expect(allows("owner", "unlock")).toBe(true)
    expect(allows("finance", "unlock")).toBe(false)
    expect(allows("ca", "unlock")).toBe(false)
    expect(allows("investor", "unlock")).toBe(false)
  })
})
