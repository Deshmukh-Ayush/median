import "server-only"

import { INDUSTRIES, chartOfAccountsFor } from "@workspace/ledger"
import type { Industry } from "@workspace/ledger"
import { z } from "zod"

import { getDb } from "../db"
import { auditLog, ledgerAccounts, organizationSettings } from "../db/schema"

/**
 * Organisation metadata the app may pass to Better Auth's createOrganization,
 * e.g. `metadata: { businessType: "d2c" }` (`industry` is still accepted).
 * Unknown or missing → SaaS template.
 */
const orgMetadataSchema = z.object({
  businessType: z.enum(INDUSTRIES).optional(),
  industry: z.enum(INDUSTRIES).optional(),
})

export function industryFromMetadata(metadata: unknown): Industry {
  let value = metadata
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return "saas"
    }
  }
  const parsed = orgMetadataSchema.safeParse(value ?? {})
  return parsed.success
    ? (parsed.data.businessType ?? parsed.data.industry ?? "saas")
    : "saas"
}

/**
 * Creates the organisation's settings row and seeds its chart of accounts
 * from the industry template, in one transaction, with an audit row.
 * Idempotent: accounts that already exist (by code) are left alone.
 */
export async function seedOrganization(input: {
  readonly orgId: string
  readonly industry: Industry
  readonly actorId: string | null
}): Promise<{ readonly accountsCreated: number }> {
  const db = getDb()
  const template = chartOfAccountsFor(input.industry)

  // Ids are assigned here so children can reference parents in one insert.
  const idByCode = new Map(template.map((t) => [t.code, crypto.randomUUID()]))
  const rows = template.map((t) => ({
    id: idByCode.get(t.code) ?? crypto.randomUUID(),
    organizationId: input.orgId,
    code: t.code,
    name: t.name,
    type: t.type,
    parentId: t.parentCode ? (idByCode.get(t.parentCode) ?? null) : null,
    isSystem: t.systemKey !== undefined,
    systemKey: t.systemKey ?? null,
    isBank: t.isBank ?? false,
  }))

  const [, inserted] = await db.batch([
    db
      .insert(organizationSettings)
      .values({
        organizationId: input.orgId,
        businessType: input.industry,
      })
      .onConflictDoNothing(),
    db
      .insert(ledgerAccounts)
      .values(rows)
      .onConflictDoNothing({
        target: [ledgerAccounts.organizationId, ledgerAccounts.code],
      })
      .returning({ id: ledgerAccounts.id }),
    db.insert(auditLog).values({
      organizationId: input.orgId,
      actorId: input.actorId,
      action: "chart_of_accounts.seed",
      entity: "organization",
      entityId: input.orgId,
      before: null,
      after: { businessType: input.industry, accounts: rows.length },
      source: "org_setup",
    }),
  ])

  return { accountsCreated: inserted.length }
}
