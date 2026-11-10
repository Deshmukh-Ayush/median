import { beforeAll, describe, expect, it } from "vitest"

import {
  checkDeletionToken,
  deletionToken,
  retentionUntilFor,
} from "./data-rights"

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgresql://test@localhost/test"
  process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-00"
  process.env.BETTER_AUTH_URL ??= "http://localhost:3000"
})

describe("retentionUntilFor", () => {
  it("is 8 years after the end of the financial year", () => {
    expect(retentionUntilFor("2026-11-10")).toBe("2035-03-31")
    expect(retentionUntilFor("2027-03-31")).toBe("2035-03-31")
    expect(retentionUntilFor("2027-04-01")).toBe("2036-03-31")
  })
})

describe("deletion tokens", () => {
  const now = new Date("2026-11-10T10:00:00Z")
  const later = new Date(now.getTime() + 15 * 60_000)
  const token = () => deletionToken("org-1", "user-1", later)

  it("accept the same user and org before expiry", () => {
    expect(checkDeletionToken(token(), "org-1", "user-1", now)).toBe(true)
  })

  it("reject another org, another user, expiry and tampering", () => {
    expect(checkDeletionToken(token(), "org-2", "user-1", now)).toBe(false)
    expect(checkDeletionToken(token(), "org-1", "user-2", now)).toBe(false)
    expect(checkDeletionToken(token(), "org-1", "user-1", later)).toBe(false)
    const [, sig] = token().split(".")
    const forged = Buffer.from(
      JSON.stringify(["org-1", "user-1", 9e15])
    ).toString("base64url")
    expect(checkDeletionToken(`${forged}.${sig}`, "org-1", "user-1", now)).toBe(
      false
    )
    expect(checkDeletionToken("garbage", "org-1", "user-1", now)).toBe(false)
  })
})
