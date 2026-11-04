import "server-only"

import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { LanguageModel } from "ai"

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

/** Cheap, fast: document extraction, categorising transactions. */
export const fastModel: LanguageModel = google("gemini-flash-lite-latest")

/** Slower, stronger: harder reasoning such as reconciliation suggestions. */
export const smartModel: LanguageModel = google("gemini-flash-latest")
