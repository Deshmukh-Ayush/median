import "server-only"

import { Pool, neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless"

import { getServerEnv } from "../env"
import * as schema from "./schema"

function createDb() {
  const sql = neon(getServerEnv().DATABASE_URL)
  return drizzle({ client: sql, schema, casing: "snake_case" })
}

export type Db = ReturnType<typeof createDb>

let db: Db | undefined

/**
 * Lazily-created Drizzle client over Neon's HTTP driver (one per instance).
 * Fast for single queries and `db.batch()`, but has no interactive
 * transactions: use `withTransaction` for those.
 */
export function getDb(): Db {
  db ??= createDb()
  return db
}

function createTxDb() {
  const pool = new Pool({ connectionString: getServerEnv().DATABASE_URL })
  return drizzleWs({ client: pool, schema, casing: "snake_case" })
}

type TxDb = ReturnType<typeof createTxDb>

/** An open interactive transaction. */
export type Tx = Parameters<Parameters<TxDb["transaction"]>[0]>[0]

let txDb: TxDb | undefined

/**
 * Runs `fn` in one interactive transaction over Neon's WebSocket pool
 * (needed when later statements depend on earlier reads, e.g. posting to the
 * ledger). Rolls back if `fn` throws.
 */
export function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  txDb ??= createTxDb()
  return txDb.transaction(fn)
}
