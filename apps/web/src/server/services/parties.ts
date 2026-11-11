import "server-only"

import {
  ServiceError,
  TDS_DEFAULT_SECTIONS,
  createPartyInputSchema,
  gstinSchema,
  idSchema,
  listPartiesFiltersSchema,
  pageOptionsSchema,
  parseInput,
  updatePartyInputSchema,
} from "@workspace/contracts"
import type {
  CreatePartyInput,
  CreatedParty,
  ListPartiesFilters,
  Page,
  PageOptions,
  Party,
  PartyKind,
  TdsDefaultSection,
  UpdatePartyInput,
} from "@workspace/contracts"
import { paise } from "@workspace/ledger"
import type { SystemAccountKey } from "@workspace/ledger"
import { and, asc, eq, gt, ilike, inArray, isNull, or } from "drizzle-orm"
import type { z } from "zod"

import { getDb, withTransaction } from "../db"
import type { Tx } from "../db"
import { auditLog, ledgerAccounts, parties } from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { isUniqueViolation } from "./db-errors"
import { postEntry } from "./ledger"
import { decodeCursor, encodeCursor } from "./pagination"
import { resolvePartyFields } from "./party-rules"
import type { PartyFields } from "./party-rules"

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

function fieldsOf(p: Party): PartyFields {
  return {
    name: p.name,
    legalName: p.legalName,
    gstin: p.gstin,
    pan: p.pan,
    registrationType: p.registrationType,
    stateCode: p.stateCode,
    billingAddress: p.billingAddress,
    email: p.email,
    phone: p.phone,
    paymentTermsDays: p.paymentTermsDays,
    defaultTdsSection: p.defaultTdsSection,
    msmeCategory: p.msmeCategory,
    udyamNumber: p.udyamNumber,
  }
}

interface PartyActor {
  readonly orgId: string
  readonly userId: string
  readonly source: string
}

/**
 * Inserts a party inside a caller's transaction and writes its audit row.
 * Internal: bill extraction and the Tally import add parties with it. An
 * opening balance needs `createParty`, which checks the posting permission.
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

const CONTROL_ACCOUNT: Record<PartyKind, SystemAccountKey> = {
  customer: "trade_receivables",
  vendor: "trade_payables",
}

/**
 * Posts a party's opening balance against Opening balance equity:
 * owed to us → Dr control account (party) / Cr opening balance equity, and
 * the other way round when we owe them. Corrected by reversing the entry.
 */
async function postOpeningBalance(
  tx: Tx,
  actor: PartyActor,
  party: Party,
  ob: NonNullable<z.output<typeof createPartyInputSchema>["openingBalance"]>
): Promise<string> {
  const keys = [CONTROL_ACCOUNT[party.kind], "opening_balance_equity"]
  const accounts = await tx
    .select({ id: ledgerAccounts.id, key: ledgerAccounts.systemKey })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.organizationId, actor.orgId),
        inArray(ledgerAccounts.systemKey, keys)
      )
    )
  const control = accounts.find((a) => a.key === keys[0])?.id
  const equity = accounts.find((a) => a.key === keys[1])?.id
  if (!control || !equity)
    throw new ServiceError(
      "VALIDATION",
      "The chart of accounts is missing a system account for opening balances."
    )
  const zero = paise(0n)
  const owedToUs = ob.direction === "owed_to_us"
  const posted = await postEntry(
    actor,
    {
      entryDate: ob.date,
      narration: `Opening balance: ${party.name}`,
      sourceType: "opening_balance",
      sourceId: party.id,
      lines: [
        {
          accountId: control,
          partyId: party.id,
          debit: owedToUs ? ob.amount : zero,
          credit: owedToUs ? zero : ob.amount,
        },
        {
          accountId: equity,
          debit: owedToUs ? zero : ob.amount,
          credit: owedToUs ? ob.amount : zero,
        },
      ],
    },
    { tx }
  )
  return posted.id
}

/**
 * Adds a customer or vendor, with its opening balance if given. State and
 * PAN come from the GSTIN. Throws VALIDATION, PERIOD_LOCKED (opening balance
 * in a locked month), CONFLICT (a party of that kind with this GSTIN exists).
 */
export async function createParty(
  ctx: OrgContext,
  input: CreatePartyInput
): Promise<CreatedParty> {
  assertCan(ctx, "ledger", "propose")
  const p = parseInput(createPartyInputSchema, input)
  if (p.openingBalance) assertCan(ctx, "ledger", "post")
  const actor = { orgId: ctx.orgId, userId: ctx.userId, source: "web" }
  try {
    return await withTransaction(async (tx) => {
      const party = await insertParty(tx, actor, input)
      const openingBalanceEntryId = p.openingBalance
        ? await postOpeningBalance(tx, actor, party, p.openingBalance)
        : null
      return { ...party, openingBalanceEntryId }
    })
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ServiceError(
        "CONFLICT",
        "A party with this GSTIN already exists."
      )
    throw error
  }
}

async function loadParty(
  db: Tx | ReturnType<typeof getDb>,
  orgId: string,
  id: string
): Promise<Party> {
  const [row] = await db
    .select(partyColumns)
    .from(parties)
    .where(and(eq(parties.organizationId, orgId), eq(parties.id, id)))
  if (!row) throw new ServiceError("NOT_FOUND", "Customer or vendor not found.")
  return toParty(row)
}

/** One party. Throws NOT_FOUND. */
export async function getParty(ctx: OrgContext, id: string): Promise<Party> {
  assertCan(ctx, "ledger", "read")
  return loadParty(getDb(), ctx.orgId, parseInput(idSchema, id))
}

/**
 * Edits a party. Issued invoices and credit notes keep the details they
 * were issued with, so any field can change; the audit row records before
 * and after. Throws VALIDATION, NOT_FOUND, CONFLICT (GSTIN already used).
 */
export async function updateParty(
  ctx: OrgContext,
  id: string,
  input: UpdatePartyInput
): Promise<Party> {
  assertCan(ctx, "ledger", "propose")
  const partyId = parseInput(idSchema, id)
  const patch = parseInput(updatePartyInputSchema, input)
  try {
    return await withTransaction(async (tx) => {
      const before = await loadParty(tx, ctx.orgId, partyId)
      const old = fieldsOf(before)
      const next = resolvePartyFields(before.kind, patch, old)
      const [row] = await tx
        .update(parties)
        .set(next)
        .where(
          and(eq(parties.organizationId, ctx.orgId), eq(parties.id, partyId))
        )
        .returning(partyColumns)
      if (!row)
        throw new ServiceError("NOT_FOUND", "Customer or vendor not found.")
      await tx.insert(auditLog).values({
        organizationId: ctx.orgId,
        actorId: ctx.userId,
        action: "party.update",
        entity: "party",
        entityId: partyId,
        before: old,
        after: next,
        source: "web",
      })
      return toParty(row)
    })
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
 * Archives a party (hidden from pickers, history kept) or restores it.
 * Archiving doesn't touch the books.
 */
export async function setPartyArchived(
  ctx: OrgContext,
  id: string,
  archived: boolean
): Promise<Party> {
  assertCan(ctx, "ledger", "propose")
  const partyId = parseInput(idSchema, id)
  return withTransaction(async (tx) => {
    const before = await loadParty(tx, ctx.orgId, partyId)
    if ((before.archivedAt !== null) === archived) return before
    const [row] = await tx
      .update(parties)
      .set({ archivedAt: archived ? new Date() : null })
      .where(
        and(eq(parties.organizationId, ctx.orgId), eq(parties.id, partyId))
      )
      .returning(partyColumns)
    if (!row)
      throw new ServiceError("NOT_FOUND", "Customer or vendor not found.")
    await tx.insert(auditLog).values({
      organizationId: ctx.orgId,
      actorId: ctx.userId,
      action: archived ? "party.archive" : "party.restore",
      entity: "party",
      entityId: partyId,
      before: { archivedAt: before.archivedAt },
      after: { archivedAt: row.archivedAt?.toISOString() ?? null },
      source: "web",
    })
    return toParty(row)
  })
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
