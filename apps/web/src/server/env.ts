import "server-only"

import { z } from "zod"

/**
 * Server environment, parsed with Zod on first use rather than at import time
 * so `next build` can run without secrets (e.g. in CI).
 */
const serverEnvSchema = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

let cached: ServerEnv | undefined

export function getServerEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  })
  return cached
}
