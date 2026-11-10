import { describe, expect, it } from "vitest"

import { aiProviderStatusFrom, requireRealDataAllowed } from "./models"

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

describe("requireRealDataAllowed", () => {
  it("blocks real data in production unless the tier is paid", () => {
    expect(() => requireRealDataAllowed({ VERCEL_ENV: "production" })).toThrow(
      expect.objectContaining({ code: "PAID_AI_REQUIRED" })
    )
    expect(() =>
      requireRealDataAllowed({
        VERCEL_ENV: "production",
        AI_PROVIDER_TIER: "free",
      })
    ).toThrow(expect.objectContaining({ code: "PAID_AI_REQUIRED" }))
    expect(() =>
      requireRealDataAllowed({
        VERCEL_ENV: "production",
        AI_PROVIDER_TIER: "paid",
      })
    ).not.toThrow()
  })

  it("passes outside production", () => {
    expect(() => requireRealDataAllowed({})).not.toThrow()
    expect(() =>
      requireRealDataAllowed({ VERCEL_ENV: "preview" })
    ).not.toThrow()
  })
})
