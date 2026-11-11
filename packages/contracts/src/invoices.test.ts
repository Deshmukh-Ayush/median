import { describe, expect, it } from "vitest"

import { dueDateFor } from "./invoices"

describe("dueDateFor", () => {
  it("adds the payment terms to the invoice date", () => {
    expect(dueDateFor("2026-10-01", 30)).toBe("2026-10-31")
    expect(dueDateFor("2026-10-01", 45)).toBe("2026-11-15")
    expect(dueDateFor("2026-10-01", 0)).toBe("2026-10-01")
  })

  it("crosses month, year and leap-day boundaries", () => {
    expect(dueDateFor("2026-12-15", 30)).toBe("2027-01-14")
    expect(dueDateFor("2028-02-15", 15)).toBe("2028-03-01")
    expect(dueDateFor("2027-02-15", 15)).toBe("2027-03-02")
  })
})
