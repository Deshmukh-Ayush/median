import "server-only"

import {
  ServiceError,
  createBankAccountInputSchema,
  listAccountsFiltersSchema,
  pageOptionsSchema,
  parseInput,
} from "@workspace/contracts"
import type {
  CreateBankAccountInput,
  LedgerAccountSummary,
  ListAccountsFilters,
  Page,
  PageOptions,
} from "@workspace/contracts"
import { and, asc, eq, gt, ilike, inArray, or } from "drizzle-orm"

import { getDb, withTransaction } from "../db"
import { auditLog, ledgerAccounts } from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { decodeCursor, encodeCursor } from "./pagination"

const accountColumns = {
  id: ledgerAccounts.id,
  code: ledgerAccounts.code,
  name: ledgerAccounts.name,
  type: ledgerAccounts.type,
  parentId: ledgerAccounts.parentId,
  isSystem: ledgerAccounts.isSystem,
  isBank: ledgerAccounts.isBank,
  bankName: ledgerAccounts.bankName,
  accountLast4: ledgerAccounts.accountLast4,
}

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
    .select(accountColumns)
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

/** Codes for bank sub-accounts under 1110: 1111–1119, then 11101–11199. */
const BANK_CODES = [
  ...Array.from({ length: 9 }, (_, i) => String(1111 + i)),
  ...Array.from({ length: 99 }, (_, i) => String(11101 + i)),
]

/**
 * Adds a bank account: a ledger sub-account of 1110 Bank, flagged as a bank,
 * with the next free code. Writes an audit row. Owners and finance only.
 * Throws VALIDATION (chart has no 1110 bank account, or no free codes).
 */
export async function createBankAccount(
  ctx: OrgContext,
  input: CreateBankAccountInput
): Promise<LedgerAccountSummary> {
  assertCan(ctx, "settings", "update")
  const { name, bankName, last4 } = parseInput(
    createBankAccountInputSchema,
    input
  )
  return withTransaction(async (tx) => {
    // Lock the parent so two creates can't take the same code.
    const [parent] = await tx
      .select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.organizationId, ctx.orgId),
          eq(ledgerAccounts.systemKey, "bank_default")
        )
      )
      .for("update")
    if (!parent)
      throw new ServiceError(
        "VALIDATION",
        "Your chart of accounts has no bank account (1110) to add banks under."
      )
    const taken = new Set(
      (
        await tx
          .select({ code: ledgerAccounts.code })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.organizationId, ctx.orgId),
              inArray(ledgerAccounts.code, BANK_CODES)
            )
          )
      ).map((r) => r.code)
    )
    const code = BANK_CODES.find((c) => !taken.has(c))
    if (!code)
      throw new ServiceError("VALIDATION", "No more bank account codes free.")
    const [created] = await tx
      .insert(ledgerAccounts)
      .values({
        organizationId: ctx.orgId,
        code,
        name,
        type: "asset",
        parentId: parent.id,
        isSystem: false,
        isBank: true,
        bankName,
        accountLast4: last4,
      })
      .returning(accountColumns)
    if (!created)
      throw new ServiceError("CONFLICT", "Couldn't create the bank account.")
    await tx.insert(auditLog).values({
      organizationId: ctx.orgId,
      actorId: ctx.userId,
      action: "ledger_account.create",
      entity: "ledger_account",
      entityId: created.id,
      before: null,
      after: { code, name, bankName, last4, isBank: true },
      source: "web",
    })
    return created
  })
}
