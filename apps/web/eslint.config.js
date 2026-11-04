import { defineConfig } from "eslint/config"

import { nextJsConfig } from "@workspace/eslint-config/next-js"

export default defineConfig(
  nextJsConfig,
  {
    // All model access goes through src/server/ai/models.ts.
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/server/ai/models.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@ai-sdk/*", "@openrouter/*"],
              message:
                "Import fastModel/smartModel from @/server/ai/models instead of a provider.",
            },
          ],
        },
      ],
    },
  },
  {
    // Heavy libraries stay off the client: static imports only on the server.
    // Elsewhere, load them with a dynamic import().
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/**", "src/app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@react-pdf/renderer",
              message:
                "Server-only. Use it from src/server or via dynamic import().",
            },
            {
              name: "papaparse",
              message:
                "Server-only. Use it from src/server or via dynamic import().",
            },
          ],
          patterns: [
            {
              group: ["@ai-sdk/*", "@openrouter/*"],
              message:
                "Import fastModel/smartModel from @/server/ai/models instead of a provider.",
            },
          ],
        },
      ],
    },
  }
)
