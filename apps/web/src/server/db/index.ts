import "server-only"

import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"

import { getServerEnv } from "../env"
import * as schema from "./schema"

function createDb() {
  const sql = neon(getServerEnv().DATABASE_URL)
  return drizzle({ client: sql, schema, casing: "snake_case" })
}

export type Db = ReturnType<typeof createDb>

let db: Db | undefined

/** Lazily-created Drizzle client over Neon's HTTP driver (one per instance). */
export function getDb(): Db {
  db ??= createDb()
  return db
}
