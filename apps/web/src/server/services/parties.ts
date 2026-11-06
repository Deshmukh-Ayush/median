import "server-only"

import {
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

import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { STUB_PARTIES, timestampDaysAgo } from "./stub-data"

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
