import "server-only"

import { z } from "zod"

import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { STUB_PARTIES, timestampDaysAgo } from "./stub-data"
import {
  gstStateCodeSchema,
  gstinSchema,
  pageOptionsSchema,
  parseInput,
} from "./types"
import type { IsoTimestamp, Page, PageOptions } from "./types"

export type PartyKind = "customer" | "vendor"

export interface Party {
  readonly id: string
  readonly kind: PartyKind
  readonly name: string
  readonly gstin: string | null
  /** Two-digit GST state code. Derived from the GSTIN when one is given. */
  readonly stateCode: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly createdAt: IsoTimestamp
}

export const createPartyInputSchema = z.object({
  kind: z.enum(["customer", "vendor"]),
  name: z.string().trim().min(1).max(200),
  gstin: gstinSchema.nullish(),
  stateCode: gstStateCodeSchema.nullish(),
  email: z.email().nullish(),
  phone: z.string().trim().max(20).nullish(),
})
export type CreatePartyInput = z.input<typeof createPartyInputSchema>

const listPartiesFiltersSchema = z.object({
  kind: z.enum(["customer", "vendor"]).optional(),
  search: z.string().trim().max(100).optional(),
})
export type ListPartiesFilters = z.input<typeof listPartiesFiltersSchema>

const stubParties: readonly Party[] = [
  {
    ...STUB_PARTIES.acme,
    kind: "customer",
    stateCode: "29",
    email: "accounts@acmeretail.in",
    phone: "+91 80 4567 1234",
    createdAt: timestampDaysAgo(40),
  },
  {
    ...STUB_PARTIES.zenith,
    kind: "customer",
    stateCode: "27",
    email: "finance@zenith.co",
    phone: null,
    createdAt: timestampDaysAgo(30),
  },
  {
    ...STUB_PARTIES.aws,
    kind: "vendor",
    stateCode: "29",
    email: null,
    phone: null,
    createdAt: timestampDaysAgo(60),
  },
]

/** STUB: echoes the input back as a new party. */
export async function createParty(
  ctx: OrgContext,
  input: CreatePartyInput
): Promise<Party> {
  assertCan(ctx, "ledger", "propose")
  const p = parseInput(createPartyInputSchema, input)
  await Promise.resolve()
  return {
    id: crypto.randomUUID(),
    kind: p.kind,
    name: p.name,
    gstin: p.gstin ?? null,
    stateCode: p.stateCode ?? p.gstin?.slice(0, 2) ?? null,
    email: p.email ?? null,
    phone: p.phone ?? null,
    createdAt: new Date().toISOString(),
  }
}

/** Parties ordered by name. STUB. */
export async function listParties(
  ctx: OrgContext,
  cursor: string | null,
  filters: ListPartiesFilters = {},
  options: PageOptions = {}
): Promise<Page<Party>> {
  assertCan(ctx, "ledger", "read")
  const f = parseInput(listPartiesFiltersSchema, filters)
  const { limit } = parseInput(pageOptionsSchema, options)
  const search = f.search?.toLowerCase()
  const items = stubParties.filter(
    (p) =>
      (!f.kind || p.kind === f.kind) &&
      (!search || p.name.toLowerCase().includes(search))
  )
  await Promise.resolve()
  return { items: cursor ? [] : items.slice(0, limit), nextCursor: null }
}

/** Finds a party by GSTIN (either kind unless given). STUB. */
export async function findPartyByGstin(
  ctx: OrgContext,
  gstin: string,
  kind?: PartyKind
): Promise<Party | null> {
  assertCan(ctx, "ledger", "read")
  const g = parseInput(gstinSchema, gstin)
  await Promise.resolve()
  return (
    stubParties.find((p) => p.gstin === g && (!kind || p.kind === kind)) ?? null
  )
}
