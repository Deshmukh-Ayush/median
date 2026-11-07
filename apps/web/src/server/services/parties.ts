import "server-only"

import {
  ServiceError,
  createPartyInputSchema,
  gstinSchema,
  listPartiesFiltersSchema,
  pageOptionsSchema,
  parseInput,
} from "@workspace/contracts"
import type {
  CreatePartyInput,
  ListPartiesFilters,
  Page,
  PageOptions,
  Party,
  PartyKind,
} from "@workspace/contracts"
import { and, asc, eq, gt, ilike, or } from "drizzle-orm"

import { getDb, withTransaction } from "../db"
import type { Tx } from "../db"
import { auditLog, parties } from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { isUniqueViolation } from "./db-errors"
import { decodeCursor, encodeCursor } from "./pagination"

const partyColumns = {
  id: parties.id,
  kind: parties.kind,
  name: parties.name,
  gstin: parties.gstin,
  stateCode: parties.stateCode,
  email: parties.email,
  phone: parties.phone,
  createdAt: parties.createdAt,
}

type PartyRow = Pick<typeof parties.$inferSelect, keyof typeof partyColumns>

function toParty(r: PartyRow): Party {
  return { ...r, createdAt: r.createdAt.toISOString() }
}

/**
 * Inserts a party inside a caller's transaction and writes its audit row.
 * Internal: bill extraction uses it to add a vendor with a valid GSTIN.
 */
export async function insertParty(
  tx: Tx,
  actor: {
    readonly orgId: string
    readonly userId: string
    readonly source: string
  },
  input: CreatePartyInput
): Promise<Party> {
  const p = parseInput(createPartyInputSchema, input)
  const fromGstin = p.gstin?.slice(0, 2) ?? null
  if (p.stateCode && fromGstin && p.stateCode !== fromGstin)
    throw new ServiceError(
      "VALIDATION",
      "State code doesn't match the GSTIN.",
      { field: "stateCode" }
    )
  const [row] = await tx
    .insert(parties)
    .values({
      organizationId: actor.orgId,
      kind: p.kind,
      name: p.name,
      gstin: p.gstin ?? null,
      stateCode: fromGstin ?? p.stateCode ?? null,
      email: p.email ?? null,
      phone: p.phone ?? null,
    })
    .returning(partyColumns)
  if (!row) throw new ServiceError("CONFLICT", "Couldn't save the party.")
  await tx.insert(auditLog).values({
    organizationId: actor.orgId,
    actorId: actor.userId,
    action: "party.create",
    entity: "party",
    entityId: row.id,
    before: null,
    after: { kind: row.kind, name: row.name, gstin: row.gstin },
    source: actor.source,
  })
  return toParty(row)
}

/**
 * Adds a customer or vendor. The state code comes from the GSTIN when one is
 * given. Throws VALIDATION, CONFLICT (a party of that kind with this GSTIN
 * already exists).
 */
export async function createParty(
  ctx: OrgContext,
  input: CreatePartyInput
): Promise<Party> {
  assertCan(ctx, "ledger", "propose")
  try {
    return await withTransaction((tx) =>
      insertParty(
        tx,
        { orgId: ctx.orgId, userId: ctx.userId, source: "web" },
        input
      )
    )
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ServiceError(
        "CONFLICT",
        "A party with this GSTIN already exists."
      )
    throw error
  }
}

/** Parties ordered by name. `search` matches the name or a GSTIN prefix. */
export async function listParties(
  ctx: OrgContext,
  cursor: string | null,
  filters: ListPartiesFilters = {},
  options: PageOptions = {}
): Promise<Page<Party>> {
  assertCan(ctx, "ledger", "read")
  const f = parseInput(listPartiesFiltersSchema, filters)
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = decodeCursor(cursor)
  const search = f.search?.replace(/[%_\\]/g, (c) => `\\${c}`)
  const rows = await getDb()
    .select(partyColumns)
    .from(parties)
    .where(
      and(
        eq(parties.organizationId, ctx.orgId),
        f.kind ? eq(parties.kind, f.kind) : undefined,
        search
          ? or(
              ilike(parties.name, `%${search}%`),
              ilike(parties.gstin, `${search}%`)
            )
          : undefined,
        after
          ? or(
              gt(parties.name, after.k),
              and(eq(parties.name, after.k), gt(parties.id, after.id))
            )
          : undefined
      )
    )
    .orderBy(asc(parties.name), asc(parties.id))
    .limit(limit + 1)
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return {
    items: items.map(toParty),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ k: last.name, id: last.id })
        : null,
  }
}

/** Finds a party by GSTIN (either kind unless given). Null if none. */
export async function findPartyByGstin(
  ctx: OrgContext,
  gstin: string,
  kind?: PartyKind
): Promise<Party | null> {
  assertCan(ctx, "ledger", "read")
  const g = parseInput(gstinSchema, gstin)
  const [row] = await getDb()
    .select(partyColumns)
    .from(parties)
    .where(
      and(
        eq(parties.organizationId, ctx.orgId),
        eq(parties.gstin, g),
        kind ? eq(parties.kind, kind) : undefined
      )
    )
    .orderBy(asc(parties.kind))
    .limit(1)
  return row ? toParty(row) : null
}
