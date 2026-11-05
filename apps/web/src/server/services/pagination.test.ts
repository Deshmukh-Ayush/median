import { ServiceError } from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import { decodeCursor, encodeCursor } from "./pagination"

describe("page cursors", () => {
  it("round-trip through an opaque string", () => {
    const cursor = {
      k: "2026-11-05",
      id: "00000000-0000-4000-8000-000000000001",
    }
    const encoded = encodeCursor(cursor)
    expect(encoded).not.toContain("2026")
    expect(decodeCursor(encoded)).toEqual(cursor)
  })

  it("treat a missing cursor as the first page", () => {
    expect(decodeCursor(null)).toBeNull()
    expect(decodeCursor("")).toBeNull()
  })

  it("reject tampered cursors with VALIDATION", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow(ServiceError)
  })
})
