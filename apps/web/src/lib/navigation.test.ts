import { describe, expect, it } from "vitest"

import { NAVIGATION, canOpen, navigationFor } from "@/lib/navigation"
import { can } from "@/lib/permissions"

const labels = (role: Parameters<typeof navigationFor>[0]) =>
  navigationFor(role).flatMap((s) => s.items.map((i) => i.label))

describe("navigation", () => {
  it("lists the twelve destinations in order", () => {
    expect(NAVIGATION.flatMap((s) => s.items.map((i) => i.label))).toEqual([
      "Home",
      "Ask Median",
      "AI inbox",
      "Revenue",
      "Cash",
      "Invoices",
      "Bills",
      "Customers and vendors",
      "GST",
      "Reports",
      "Ledger",
      "Settings",
    ])
  })

  it("shows owners, finance and CAs everything", () => {
    for (const role of ["owner", "finance", "ca"] as const) {
      expect(labels(role)).toHaveLength(12)
    }
  })

  it("hides the AI inbox from investors, who can't propose entries", () => {
    expect(labels("investor")).not.toContain("AI inbox")
    expect(labels("investor")).toContain("Reports")
    expect(canOpen("investor", "/inbox")).toBe(false)
    expect(canOpen("finance", "/inbox")).toBe(true)
  })
})

describe("can", () => {
  it("lets only owners invite members", () => {
    expect(can("owner", { resource: "invitation", action: "create" })).toBe(
      true
    )
    for (const role of ["finance", "ca", "investor"] as const) {
      expect(can(role, { resource: "invitation", action: "create" })).toBe(
        false
      )
    }
  })
})
