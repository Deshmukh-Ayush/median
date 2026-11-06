// Loads HSN/SAC codes and effective-dated GST rates into the shared master
// (hsn_sac_codes, hsn_sac_rates). Idempotent: existing windows are kept; a row
// that changes an existing window's rate is an error, never an overwrite.
//
// Rates come only from official notifications, each row citing its source.
// Never invent or estimate a rate. data/hsn-sac-rates.csv ships header-only.
//
// Usage (from apps/web):
//   npm run db:import-hsn -- [file.csv] [--dry-run]

import { readFileSync } from "node:fs"

import { Pool } from "@neondatabase/serverless"
import { and, eq, isNull } from "drizzle-orm"
import { drizzle } from "drizzle-orm/neon-serverless"

import { parseHsnSacRatesCsv } from "../src/server/db/hsn-sac-import"
import { hsnSacCodes, hsnSacRates } from "../src/server/db/schema"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const file = args.find((a) => !a.startsWith("--")) ?? "data/hsn-sac-rates.csv"

const { rows, errors } = parseHsnSacRatesCsv(readFileSync(file, "utf8"))
for (const e of errors) console.error(`${file}:${e.line}: ${e.message}`)
if (errors.length > 0) {
  console.error(`${errors.length} invalid row(s); nothing imported.`)
  process.exit(1)
}
if (rows.length === 0) {
  console.log(`${file} has no rates. Nothing to import.`)
  process.exit(0)
}
if (dryRun) {
  console.log(`${rows.length} valid row(s). Dry run: nothing written.`)
  process.exit(0)
}

try {
  process.loadEnvFile(".env.local")
} catch {
  // No .env.local: rely on the real environment.
}
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.")
  process.exit(1)
}

const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle({ client: pool, casing: "snake_case" })
let inserted = 0
let unchanged = 0
try {
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .insert(hsnSacCodes)
        .values({
          code: row.code,
          kind: row.code.startsWith("99") ? "sac" : "hsn",
          description: row.description,
        })
        .onConflictDoUpdate({
          target: hsnSacCodes.code,
          set: { description: row.description },
        })
      const [existing] = await tx
        .select({ rate: hsnSacRates.gstRateBps, to: hsnSacRates.effectiveTo })
        .from(hsnSacRates)
        .where(
          and(
            eq(hsnSacRates.code, row.code),
            eq(hsnSacRates.effectiveFrom, row.effectiveFrom),
            row.condition === null
              ? isNull(hsnSacRates.condition)
              : eq(hsnSacRates.condition, row.condition)
          )
        )
      if (existing) {
        if (existing.rate !== row.rateBps || existing.to !== row.effectiveTo) {
          throw new Error(
            `${row.code} from ${row.effectiveFrom}: already ${existing.rate} bps to ${existing.to ?? "open"}; refusing to overwrite. Add a new window instead.`
          )
        }
        unchanged++
        continue
      }
      // The exclusion constraint rejects windows overlapping stored ones.
      await tx.insert(hsnSacRates).values({
        code: row.code,
        gstRateBps: row.rateBps,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        condition: row.condition,
        source: row.source,
      })
      inserted++
    }
  })
  console.log(`Imported ${inserted} rate(s); ${unchanged} already present.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await pool.end()
}
