import "server-only"

import {
  ServiceError,
  bankRowSchema,
  idSchema,
  parseInput,
} from "@workspace/contracts"
import type {
  BankLineMatched,
  BankLineUnmatched,
  BankMatchKind,
  BankRow,
} from "@workspace/contracts"
import { and, eq, or } from "drizzle-orm"
import { z } from "zod"

import { getDb } from "../db"
import { connections } from "../db/schema"
import { importFile } from "./connectors"
import { requireConsent } from "./consent"
import type { OrgContext } from "./context"
import { assertCan } from "./context"

/** Moved to @workspace/contracts; re-exported for existing imports. */
export { bankRowSchema }
export type { BankMatchKind, BankRow }

export const importBankRowsOptionsSchema = z.object({
  /** The bank connection, or the bank ledger account it posts to. */
  bankAccountId: idSchema,
})
export type ImportBankRowsOptions = z.input<typeof importBankRowsOptionsSchema>

export interface BankImportResult {
  readonly imported: number
  /** Rows already imported before (rule 12 dedupe). */
  readonly duplicates: number
  readonly matched: readonly BankLineMatched[]
  readonly unmatched: readonly BankLineUnmatched[]
  readonly errors: readonly {
    readonly rowIndex: number
    readonly message: string
  }[]
}

/**
 * @deprecated Use `importFile(ctx, "bank-statement", { kind: "rows", … },
 * { connectionId })`. Kept as a thin wrapper so existing screens work.
 */
export async function importBankRows(
  ctx: OrgContext,
  rows: readonly unknown[],
  options: ImportBankRowsOptions
): Promise<BankImportResult> {
  assertCan(ctx, "ledger", "post")
  const { bankAccountId } = parseInput(importBankRowsOptionsSchema, options)
  await requireConsent(ctx)
  const [connection] = await getDb()
    .select({ id: connections.id })
    .from(connections)
    .where(
      and(
        eq(connections.organizationId, ctx.orgId),
        eq(connections.provider, "bank-statement"),
        or(
          eq(connections.id, bankAccountId),
          eq(connections.ledgerAccountId, bankAccountId)
        )
      )
    )
    .limit(1)
  if (!connection)
    throw new ServiceError(
      "NOT_FOUND",
      "Connect this bank account first (Settings → Integrations)."
    )
  const result = await importFile(
    ctx,
    "bank-statement",
    { kind: "rows", fileName: "rows.json", rows: [...rows] },
    { connectionId: connection.id }
  )
  return {
    imported: result.imported,
    duplicates: result.duplicates,
    matched: result.matched ?? [],
    unmatched: result.unmatched ?? [],
    errors: result.errors.map((e) => ({
      rowIndex: e.index,
      message: e.message,
    })),
  }
}
