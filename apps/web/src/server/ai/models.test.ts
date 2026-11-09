import { describe, expect, it } from "vitest"

import { aiProviderStatusFrom } from "./models"

describe("aiProviderStatusFrom", () => {
  it("treats an undeclared tier as free", () => {
    const s = aiProviderStatusFrom({})
    expect(s).toMatchObject({
      provider: "Google Gemini",
      tier: "free",
      tierDeclared: false,
      keyConfigured: false,
      production: false,
      freeTierInProduction: false,
    })
  })

  it("warns only for the free tier in production", () => {
    expect(
      aiProviderStatusFrom({ VERCEL_ENV: "production" }).freeTierInProduction
    ).toBe(true)
    expect(
      aiProviderStatusFrom({
        VERCEL_ENV: "production",
        AI_PROVIDER_TIER: "free",
      }).freeTierInProduction
    ).toBe(true)
    expect(
      aiProviderStatusFrom({
        VERCEL_ENV: "production",
        AI_PROVIDER_TIER: "paid",
      }).freeTierInProduction
    ).toBe(false)
    expect(
      aiProviderStatusFrom({ VERCEL_ENV: "preview" }).freeTierInProduction
    ).toBe(false)
  })

  it("counts an unknown tier value as free, and notices the key", () => {
    const s = aiProviderStatusFrom({
      AI_PROVIDER_TIER: "enterprise",
      GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
    })
    expect(s.tier).toBe("free")
    expect(s.tierDeclared).toBe(false)
    expect(s.keyConfigured).toBe(true)
  })
})
