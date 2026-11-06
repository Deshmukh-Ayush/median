import "server-only"

import {
  listAccountsFiltersSchema,
  pageOptionsSchema,
  parseInput,
} from "@workspace/contracts"
import type {
  AccountType,
  LedgerAccountSummary,
  ListAccountsFilters,
  Page,
  PageOptions,
} from "@workspace/contracts"

import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { STUB_ACCOUNT_LIST } from "./stub-data"

/**
 * Chart of accounts for pickers (inbox edits, manual entries), ordered by
 * code. STUB: returns the startup template.
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
  const type: AccountType | undefined = f.type
  const search = f.search?.toLowerCase()
  const items = STUB_ACCOUNT_LIST.filter(
    (a) =>
      (!type || a.type === type) &&
      (!search ||
        a.name.toLowerCase().includes(search) ||
        a.code.startsWith(search))
  )
  await Promise.resolve()
  return { items: cursor ? [] : items.slice(0, limit), nextCursor: null }
}
