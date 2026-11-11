import "server-only"

import {
  ServiceError,
  TDS_DEFAULT_SECTIONS,
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
  TdsDefaultSection,
} from "@workspace/contracts"
import { and, asc, eq, gt, ilike, isNull, or } from "drizzle-orm"

import { getDb, withTransaction } from "../db"
import type { Tx } from "../db"
import { auditLog, parties } from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { isUniqueViolation } from "./db-errors"
import { decodeCursor, encodeCursor } from "./pagination"
import { resolvePartyFields } from "./party-rules"

const partyColumns = {
  id: parties.id,
  kind: parties.kind,
  name: parties.name,
  legalName: parties.legalName,
  gstin: parties.gstin,
  pan: parties.pan,
  registrationType: parties.registrationType,
  stateCode: parties.stateCode,
  billingAddress: parties.billingAddress,
  email: parties.email,
  phone: parties.phone,
  paymentTermsDays: parties.paymentTermsDays,
  defaultTdsSection: parties.defaultTdsSection,
  msmeCategory: parties.msmeCategory,
  udyamNumber: parties.udyamNumber,
  archivedAt: parties.archivedAt,
  createdAt: parties.createdAt,
}

type PartyRow = Pick<typeof parties.$inferSelect, keyof typeof partyColumns>

function isTdsSection(s: string | null): s is TdsDefaultSection {
  return TDS_DEFAULT_SECTIONS.some((t) => t === s)
}

function toParty(r: PartyRow): Party {
  return {
    ...r,
    defaultTdsSection: isTdsSection(r.defaultTdsSection)
      ? r.defaultTdsSection
      : null,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

interface PartyActor {
  readonly orgId: string
  readonly userId: string
  readonly source: string
}

/**
 * Inserts a party inside a caller's transaction and writes its audit row.
 * Internal: bill extraction and the Tally import add parties with it.
 */
export async function insertParty(
  tx: Tx,
  actor: PartyActor,
  input: CreatePartyInput
): Promise<Party> {
  const p = parseInput(createPartyInputSchema, input)
  const fields = resolvePartyFields(p.kind, p)
  const [row] = await tx
    .insert(parties)
    .values({ organizationId: actor.orgId, kind: p.kind, ...fields })
    .returning(partyColumns)
  if (!row) throw new ServiceError("CONFLICT", "Couldn't save the party.")
  await tx.insert(auditLog).values({
    organizationId: actor.orgId,
    actorId: actor.userId,
    action: "party.create",
    entity: "party",
    entityId: row.id,
    before: null,
    after: { kind: row.kind, ...fields },
    source: actor.source,
  })
  return toParty(row)
}

/**
 * Adds a customer or vendor. State and PAN come from the GSTIN. Throws
 * VALIDATION, CONFLICT (a party of that kind with this GSTIN exists).
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

/**
 * Parties ordered by name. `search` matches the name or a GSTIN prefix.
 * Archived parties are left out unless `includeArchived`.
 */
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
        f.includeArchived ? undefined : isNull(parties.archivedAt),
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
