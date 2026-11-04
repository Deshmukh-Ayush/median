import { defineConfig } from "eslint/config"

import { config } from "@workspace/eslint-config/base"

// packages/ledger is pure TypeScript: no framework, database, AI or app code.
export default defineConfig(config, {
  files: ["src/**/*.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: [
              "next",
              "next/*",
              "react",
              "react-*",
              "drizzle-orm",
              "drizzle-orm/*",
              "@neondatabase/*",
              "better-auth",
              "better-auth/*",
              "ai",
              "@ai-sdk/*",
              "@openrouter/*",
              "web",
              "web/*",
              "@/*",
              "@workspace/ui",
              "@workspace/ui/*",
            ],
            message:
              "packages/ledger must stay pure: no framework, DB, AI or app imports.",
          },
        ],
      },
    ],
  },
})
