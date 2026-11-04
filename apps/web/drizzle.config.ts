import { defineConfig } from "drizzle-kit"

// drizzle-kit runs outside Next.js, so load .env.local ourselves (Node built-in).
try {
  process.loadEnvFile(".env.local")
} catch {
  // No .env.local: rely on the real environment (e.g. CI).
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.")
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
})
