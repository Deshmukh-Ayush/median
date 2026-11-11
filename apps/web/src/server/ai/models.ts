import "server-only"

import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { ServiceError } from "@workspace/contracts"
import { wrapLanguageModel } from "ai"
import type { LanguageModel, LanguageModelMiddleware } from "ai"
import { z } from "zod"

/**
 * The ONLY module in the app that knows which AI providers and models we use.
 * Everything else imports a model from here.
 *
 * - `fastModel` / `smartModel` (extraction, inbox suggestions, categorising):
 *   Google Gemini, key from GOOGLE_GENERATIVE_AI_API_KEY.
 * - `getAskModel()` (Ask Median): AI_PROVIDER=openrouter|gemini. OpenRouter
 *   uses OPENROUTER_API_KEY and a fallback model; gemini is smartModel.
 *   Switching back is one env change.
 *
 * Free tiers (Gemini free, OpenRouter ":free" models): TEST DATA ONLY. Never
 * send real customer data to them.
 *
 * The AI never does maths: it extracts and suggests, and its output (typed
 * `unknown`, parsed with Zod) goes to an approval queue, never to the ledger.
 */
const google = createGoogleGenerativeAI()

const PROVIDER = "Google Gemini"
const FAST_MODEL_ID = "gemini-flash-lite-latest"
const SMART_MODEL_ID = "gemini-flash-latest"

/** Ask Median on OpenRouter (paid, credits): tool calling required. */
const OPENROUTER_ASK_MODEL_ID = "nvidia/nemotron-3.5-super-vl"
/** Tried by OpenRouter when the first model is busy; also tool-capable. */
const OPENROUTER_ASK_FALLBACK_IDS = ["google/gemma-4-31b-it:free"] as const

/** Cheap, fast: document extraction, categorising transactions. */
export const fastModel: LanguageModel = google(FAST_MODEL_ID)

/** Slower, stronger: harder reasoning such as reconciliation suggestions. */
export const smartModel: LanguageModel = google(SMART_MODEL_ID)

export type AiTier = "paid" | "free"
export type AskProvider = "gemini" | "openrouter"

export interface AiProviderStatus {
  readonly provider: string
  readonly fastModel: string
  readonly smartModel: string
  /** Ask Median's provider (AI_PROVIDER) and model. */
  readonly askProvider: AskProvider
  readonly askModel: string
  readonly askFallbackModels: readonly string[]
  /**
   * From AI_PROVIDER_TIER. A Gemini key doesn't say whether billing is on,
   * so it's declared; anything but "paid" counts as the free tier. An
   * OpenRouter ":free" model is always the free tier, whatever is declared.
   */
  readonly tier: AiTier
  readonly tierDeclared: boolean
  readonly keyConfigured: boolean
  readonly askKeyConfigured: boolean
  /** VERCEL_ENV=production. */
  readonly production: boolean
  /** Real customer data would reach a free-tier key: warn owners. */
  readonly freeTierInProduction: boolean
}

const envSchema = z.object({
  AI_PROVIDER: z.enum(["openrouter", "gemini"]).optional().catch(undefined),
  AI_PROVIDER_TIER: z.enum(["paid", "free"]).optional().catch(undefined),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  VERCEL_ENV: z.string().optional(),
})

/** Which providers are active and whether they're safe for real data. Pure. */
export function aiProviderStatusFrom(
  env: Readonly<Record<string, string | undefined>>
): AiProviderStatus {
  const e = envSchema.parse(env)
  const askProvider: AskProvider = e.AI_PROVIDER ?? "gemini"
  const askModel =
    askProvider === "openrouter" ? OPENROUTER_ASK_MODEL_ID : SMART_MODEL_ID
  const askFallbackModels =
    askProvider === "openrouter" ? [...OPENROUTER_ASK_FALLBACK_IDS] : []
  const freeModel = [askModel, ...askFallbackModels].some((id) =>
    id.endsWith(":free")
  )
  const tier: AiTier =
    e.AI_PROVIDER_TIER === "paid" && !freeModel ? "paid" : "free"
  const production = e.VERCEL_ENV === "production"
  const googleKey = Boolean(e.GOOGLE_GENERATIVE_AI_API_KEY?.trim())
  return {
    provider: PROVIDER,
    fastModel: FAST_MODEL_ID,
    smartModel: SMART_MODEL_ID,
    askProvider,
    askModel,
    askFallbackModels,
    tier,
    tierDeclared: e.AI_PROVIDER_TIER !== undefined,
    keyConfigured: googleKey,
    askKeyConfigured:
      askProvider === "openrouter"
        ? Boolean(e.OPENROUTER_API_KEY?.trim())
        : googleKey,
    production,
    freeTierInProduction: production && tier === "free",
  }
}

export function getAiProviderStatus(): AiProviderStatus {
  return aiProviderStatusFrom(process.env)
}

/**
 * Spaces model requests at least `minGapMs` apart in this process, for
 * rate-limited free tiers (OpenRouter free: 20 requests a minute).
 */
export function spacedRequests(minGapMs: number): LanguageModelMiddleware {
  const turn = createSpacer(minGapMs)
  return {
    transformParams: async ({ params }) => {
      await turn()
      return params
    },
  }
}

/** Resolves each call at least `minGapMs` after the previous one. */
export function createSpacer(minGapMs: number): () => Promise<void> {
  let nextAt = 0
  return async () => {
    const now = Date.now()
    const wait = Math.max(0, nextAt - now)
    nextAt = Math.max(now, nextAt) + minGapMs
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  }
}

const gapSchema = z.coerce.number().int().min(0).max(60_000).catch(0)

/**
 * Ask Median's model, per AI_PROVIDER (read when called, so an env change
 * needs no code change). AI_MIN_REQUEST_GAP_MS spaces its requests.
 */
export function getAskModel(
  env: Readonly<Record<string, string | undefined>> = process.env
): LanguageModel {
  const status = aiProviderStatusFrom(env)
  const model =
    status.askProvider === "openrouter"
      ? createOpenRouter({
          // Read here, never logged.
          apiKey: env.OPENROUTER_API_KEY ?? "",
        }).chat(OPENROUTER_ASK_MODEL_ID, {
          models: [...OPENROUTER_ASK_FALLBACK_IDS],
          provider: {
            // Only providers that support every parameter we send (tools)…
            require_parameters: true,
            // …and that don't keep or train on our prompts.
            data_collection: "deny",
            allow_fallbacks: true,
          },
          // Report tokens and cost (providerMetadata.openrouter.usage).
          usage: { include: true },
        })
      : google(SMART_MODEL_ID)
  const gapMs = gapSchema.parse(env.AI_MIN_REQUEST_GAP_MS ?? 0)
  return gapMs > 0
    ? wrapLanguageModel({ model, middleware: spacedRequests(gapMs) })
    : model
}

/**
 * Hard check for anything that brings real customer data in (import, sync,
 * document upload) or sends it to the AI (extraction, Ask Median). In
 * production it throws PAID_AI_REQUIRED unless AI_PROVIDER_TIER=paid and no
 * ":free" model is in use, because a free tier may let the provider use what
 * it's sent. Outside production it passes: dev and preview use test data.
 */
export function requireRealDataAllowed(
  env: Readonly<Record<string, string | undefined>> = process.env
): void {
  if (aiProviderStatusFrom(env).freeTierInProduction) {
    throw new ServiceError(
      "PAID_AI_REQUIRED",
      "Imports and AI reading are off: production is on an AI provider's free tier. An owner must enable billing, use a paid model and set AI_PROVIDER_TIER=paid."
    )
  }
}
