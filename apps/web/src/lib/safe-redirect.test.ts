import { describe, expect, it } from "vitest"

import { safeRedirect } from "@/lib/safe-redirect"

describe("safeRedirect", () => {
  it.each(["/", "/invoices", "/accept-invitation/abc?x=1"])(
    "keeps the same-site path %s",
    (path) => {
      expect(safeRedirect(path)).toBe(path)
    }
  )

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "invoices",
    "/x\nSet-Cookie: a",
    null,
    undefined,
    42,
  ])("falls back for %s", (value) => {
    expect(safeRedirect(value)).toBe("/")
  })
})
