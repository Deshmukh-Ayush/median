// Applies apps/web/drizzle migrations and prints the real Postgres error if
// one fails. Replaces `drizzle-kit migrate`, whose progress spinner (0.31.x)
// swallows the error and exits 1 silently.
//
// Usage (from apps/web): npm run db:migrate

import { Pool } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-serverless"
import { migrate } from "drizzle-orm/neon-serverless/migrator"

try {
  process.loadEnvFile(".env.local")
} catch {
  // No .env.local: rely on the real environment (e.g. CI).
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local.")
  process.exit(1)
}

/** Prints an error and its causes, with Postgres fields when present. */
function report(error: unknown): void {
  let current: unknown = error
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    if (current instanceof Error) {
      console.error(
        `${depth === 0 ? "Migration failed" : "Caused by"}: ${current.message}`
      )
      for (const field of ["code", "detail", "hint", "where", "position"]) {
        const value: unknown = Reflect.get(current, field)
        if (typeof value === "string" && value !== "") {
          console.error(`  ${field}: ${value}`)
        }
      }
      current = current.cause
    } else if (
      typeof current === "object" &&
      current !== null &&
      "type" in current &&
      current.type === "error"
    ) {
      // A WebSocket ErrorEvent from the Neon driver: the connection failed.
      const inner: unknown = Reflect.get(current, "error")
      console.error(
        "Caused by: couldn't connect to the database over WebSocket. Check DATABASE_URL (Neon's pooled connection string) and your network."
      )
      current = inner instanceof Error ? inner : undefined
    } else {
      console.error(current)
      current = undefined
    }
  }
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 })
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" })
  console.log("Migrations applied.")
} catch (error) {
  report(error)
  process.exitCode = 1
} finally {
  await pool.end()
}
