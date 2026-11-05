import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Evals run with Vitest so they share the app's aliases and TypeScript setup.
// They are not part of `npm test`: they call a real model (synthetic data
// only) and write fixtures or reports. See evals/bills/README.md.
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
  test: {
    include: ["evals/**/*.eval.ts"],
    environment: "node",
    testTimeout: 60 * 60 * 1000,
    fileParallelism: false,
  },
})
