import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Server-side unit tests (services, integrations). No database: tests that
// need Postgres come later with a test branch.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" throws outside React Server Components; tests run in Node.
      "server-only": fileURLToPath(
        new URL("./test/server-only.ts", import.meta.url)
      ),
    },
  },
  // tsconfig has jsx: "preserve" for Next; tests (the PDF documents) need
  // the JSX compiled.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
