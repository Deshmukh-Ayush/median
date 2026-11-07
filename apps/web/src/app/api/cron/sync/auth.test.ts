import { describe, expect, it } from "vitest"

import { checkCronAuth } from "./auth"

const SECRET = "s3cret-for-tests-0123456789"

describe("checkCronAuth", () => {
  it("accepts the exact bearer secret", () => {
    expect(checkCronAuth(`Bearer ${SECRET}`, SECRET)).toBe("ok")
  })

  it.each([
    null,
    "",
    SECRET,
    `bearer ${SECRET}`,
    `Bearer ${SECRET} `,
    `Bearer ${SECRET.slice(0, -1)}`,
    `Bearer ${SECRET}x`,
    "Bearer ",
  ])("rejects %j", (header) => {
    expect(checkCronAuth(header, SECRET)).toBe("unauthorized")
  })

  it.each([undefined, "", "too-short"])(
    "refuses everything when the secret is %j",
    (secret) => {
      expect(checkCronAuth(`Bearer ${secret ?? ""}`, secret)).toBe(
        "not_configured"
      )
    }
  )
})
