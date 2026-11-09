import "server-only"

import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { LanguageModel } from "ai"
import { z } from "zod"

/**
 * The ONLY module in the app that knows which AI provider and models we use.
 * Everything else imports `fastModel` / `smartModel` from here. To move to
 * Vercel AI Gateway or OpenRouter, change this file only.
 *
 * Gemini free tier: TEST DATA ONLY. Never send real customer data to it.
 * The API key is read from GOOGLE_GENERATIVE_AI_API_KEY at call time.
 *
 * The AI never does maths: it extracts and suggests, and its output (typed
 * `unknown`, parsed with Zod) goes to an approval queue, never to the ledger.
 */
const google = createGoogleGenerativeAI()

const PROVIDER = "Google Gemini"
const FAST_MODEL_ID = "gemini-flash-lite-latest"
const SMART_MODEL_ID = "gemini-flash-latest"

/** Cheap, fast: document extraction, categorising transactions. */
export const fastModel: LanguageModel = google(FAST_MODEL_ID)

/** Slower, stronger: harder reasoning such as reconciliation suggestions. */
export const smartModel: LanguageModel = google(SMART_MODEL_ID)

export type AiTier = "paid" | "free"

export interface AiProviderStatus {
  readonly provider: string
  readonly fastModel: string
  readonly smartModel: string
  /**
   * From AI_PROVIDER_TIER. A Gemini key doesn't say whether billing is on,
   * so it's declared; anything but "paid" counts as the free tier.
   */
  readonly tier: AiTier
  readonly tierDeclared: boolean
  readonly keyConfigured: boolean
  /** VERCEL_ENV=production. */
  readonly production: boolean
  /** Real customer data would reach a free-tier key: warn owners. */
  readonly freeTierInProduction: boolean
}

const envSchema = z.object({
  AI_PROVIDER_TIER: z.enum(["paid", "free"]).optional().catch(undefined),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  VERCEL_ENV: z.string().optional(),
})

/** Which provider is active and whether it's safe for real data. Pure. */
export function aiProviderStatusFrom(
  env: Readonly<Record<string, string | undefined>>
): AiProviderStatus {
  const e = envSchema.parse(env)
  const tier: AiTier = e.AI_PROVIDER_TIER === "paid" ? "paid" : "free"
  const production = e.VERCEL_ENV === "production"
  return {
    provider: PROVIDER,
    fastModel: FAST_MODEL_ID,
    smartModel: SMART_MODEL_ID,
    tier,
    tierDeclared: e.AI_PROVIDER_TIER !== undefined,
    keyConfigured: Boolean(e.GOOGLE_GENERATIVE_AI_API_KEY?.trim()),
    production,
    freeTierInProduction: production && tier === "free",
  }
}

export function getAiProviderStatus(): AiProviderStatus {
  return aiProviderStatusFrom(process.env)
}
