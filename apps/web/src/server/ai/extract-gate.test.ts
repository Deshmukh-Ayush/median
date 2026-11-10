import { afterEach, describe, expect, it, vi } from "vitest"

import { extractBankStatement } from "./extract-bank-statement"
import { extractBill } from "./extract-bill"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("AI extraction in production", () => {
  it("refuses before calling the model on a free-tier key", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    vi.stubEnv("AI_PROVIDER_TIER", "free")
    const data = new Uint8Array([1])
    await expect(
      extractBill({ data, mediaType: "application/pdf" })
    ).rejects.toMatchObject({ code: "PAID_AI_REQUIRED" })
    await expect(extractBankStatement({ data })).rejects.toMatchObject({
      code: "PAID_AI_REQUIRED",
    })
  })
})
