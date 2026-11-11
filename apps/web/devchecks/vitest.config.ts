// Opt-in checks against a real database (the dev-backend Neon branch in
// .env.local). They create and reuse a dedicated org, "Backend dev checks",
// and write synthetic data to it. Never point this at production.
//
//   npm run test:dev-db -- [file]
//
// sync.check.ts calls the real Razorpay test account (RAZORPAY_KEY_ID/SECRET).

import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)))

export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("../test/server-only.ts", import.meta.url)
      ),
    },
  },
  // tsconfig has jsx: "preserve" for Next; the invoice PDF needs it compiled.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["devchecks/**/*.check.ts"],
    environment: "node",
    testTimeout: 120_000,
    fileParallelism: false,
  },
})
