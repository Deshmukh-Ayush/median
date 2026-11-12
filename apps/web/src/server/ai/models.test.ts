import type { LanguageModel } from "ai"
import { describe, expect, it, vi } from "vitest"

import {
  aiProviderStatusFrom,
  getAskModel,
  requireRealDataAllowed,
  createSpacer,
} from "./models"

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

const idOf = (m: LanguageModel) => (typeof m === "string" ? m : m.modelId)

describe("Ask Median provider switch", () => {
  it("defaults to Gemini's smart model", () => {
    const s = aiProviderStatusFrom({ GOOGLE_GENERATIVE_AI_API_KEY: "k" })
    expect(s).toMatchObject({
      askProvider: "gemini",
      askModel: "gemini-flash-latest",
      askFallbackModels: [],
      askKeyConfigured: true,
    })
    expect(idOf(getAskModel({}))).toBe("gemini-flash-latest")
  })

  it("uses OpenRouter with a fallback model on AI_PROVIDER=openrouter", () => {
    const env = { AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" }
    const s = aiProviderStatusFrom(env)
    expect(s).toMatchObject({
      askProvider: "openrouter",
      askModel: "nvidia/nemotron-3.5-super-vl",
      askFallbackModels: ["google/gemma-4-31b-it:free"],
      askKeyConfigured: true,
    })
    expect(idOf(getAskModel(env))).toBe("nvidia/nemotron-3.5-super-vl")
    expect(
      aiProviderStatusFrom({ AI_PROVIDER: "openrouter" }).askKeyConfigured
    ).toBe(false)
  })

  it("treats an unknown provider as Gemini", () => {
    expect(aiProviderStatusFrom({ AI_PROVIDER: "other" }).askProvider).toBe(
      "gemini"
    )
  })

  it("counts a :free fallback as the free tier even when paid is declared", () => {
    const env = {
      AI_PROVIDER: "openrouter",
      AI_PROVIDER_TIER: "paid",
      VERCEL_ENV: "production",
    }
    expect(aiProviderStatusFrom(env).tier).toBe("free")
    expect(() => requireRealDataAllowed(env)).toThrow(
      expect.objectContaining({ code: "PAID_AI_REQUIRED" })
    )
  })
})

describe("createSpacer", () => {
  it("spaces calls at least the gap apart", async () => {
    vi.useFakeTimers()
    try {
      const turn = createSpacer(3000)
      const start = Date.now()
      const done: number[] = []
      const all = [turn(), turn(), turn()].map((p) =>
        p.then(() => done.push(Date.now() - start))
      )
      await vi.advanceTimersByTimeAsync(10_000)
      await Promise.all(all)
      expect(done).toEqual([0, 3000, 6000])
    } finally {
      vi.useRealTimers()
    }
  })
})
