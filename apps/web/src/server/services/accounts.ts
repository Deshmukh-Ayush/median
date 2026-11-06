import "server-only"

import {
  listAccountsFiltersSchema,
  pageOptionsSchema,
  parseInput,
} from "@workspace/contracts"
import type {
  LedgerAccountSummary,
  ListAccountsFilters,
  Page,
  PageOptions,
} from "@workspace/contracts"
import { and, asc, eq, gt, ilike, or } from "drizzle-orm"

import { getDb } from "../db"
import { ledgerAccounts } from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { decodeCursor, encodeCursor } from "./pagination"

/** Escapes LIKE wildcards in user search text. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * The organisation's chart of accounts for pickers (inbox edits, manual
 * entries, bank connections), ordered by code. `search` matches the name
 * anywhere or the code from its start; `bankOnly` keeps bank accounts.
 */
export async function listLedgerAccounts(
  ctx: OrgContext,
  cursor: string | null,
  filters: ListAccountsFilters = {},
  options: PageOptions = {}
): Promise<Page<LedgerAccountSummary>> {
  assertCan(ctx, "ledger", "read")
  const f = parseInput(listAccountsFiltersSchema, filters)
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = decodeCursor(cursor)
  const search = f.search ? likeEscape(f.search) : null

  const rows = await getDb()
    .select({
      id: ledgerAccounts.id,
      code: ledgerAccounts.code,
      name: ledgerAccounts.name,
      type: ledgerAccounts.type,
      parentId: ledgerAccounts.parentId,
      isSystem: ledgerAccounts.isSystem,
      isBank: ledgerAccounts.isBank,
    })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.organizationId, ctx.orgId),
        f.type ? eq(ledgerAccounts.type, f.type) : undefined,
        f.bankOnly ? eq(ledgerAccounts.isBank, true) : undefined,
        search
          ? or(
              ilike(ledgerAccounts.name, `%${search}%`),
              ilike(ledgerAccounts.code, `${search}%`)
            )
          : undefined,
        // Codes are unique per organisation, so the code alone is the key.
        after ? gt(ledgerAccounts.code, after.k) : undefined
      )
    )
    .orderBy(asc(ledgerAccounts.code))
    .limit(limit + 1)

  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ k: last.code, id: last.id })
        : null,
  }
}
