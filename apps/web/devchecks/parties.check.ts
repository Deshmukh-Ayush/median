import { and, eq } from "drizzle-orm"
import { expect, it } from "vitest"

import { getDb } from "../src/server/db"
import { journalLines, organizationSettings } from "../src/server/db/schema"
import { createInvoice } from "../src/server/services/invoices"
import { reverseEntry } from "../src/server/services/ledger"
import {
  createParty,
  getParty,
  listParties,
  setPartyArchived,
  updateParty,
} from "../src/server/services/parties"
import { istDateOf } from "../src/server/services/posting-rules"
import { freshDevOrg } from "./setup"

it("customers and vendors: details, opening balance, locks, archive", async () => {
  const ctx = await freshDevOrg("parties")
  const db = getDb()
  await db
    .update(organizationSettings)
    .set({
      gstRegistered: true,
      gstin: "27AAHCM4321Q1Z2",
      stateCode: "27",
      compositionScheme: false,
    })
    .where(eq(organizationSettings.organizationId, ctx.orgId))
  const today = istDateOf(new Date())

  // A typo in the GSTIN is caught; a valid one fills state and PAN.
  await expect(
    createParty(ctx, {
      kind: "customer",
      name: "Acme",
      gstin: "27AAPCA1234F1Z5",
    })
  ).rejects.toMatchObject({ code: "VALIDATION" })
  const acme = await createParty(ctx, {
    kind: "customer",
    name: "Acme Retail",
    gstin: "27AAPCA1234F1ZV",
    paymentTermsDays: 30,
    openingBalance: {
      date: today,
      amount: 50_000_00n,
      direction: "owed_to_us",
    },
  })
  expect(acme).toMatchObject({
    stateCode: "27",
    pan: "AAPCA1234F",
    registrationType: "regular",
  })
  expect(acme.openingBalanceEntryId).not.toBeNull()
  const lines = await db
    .select({
      partyId: journalLines.partyId,
      debit: journalLines.debitPaise,
      credit: journalLines.creditPaise,
    })
    .from(journalLines)
    .where(
      and(
        eq(journalLines.organizationId, ctx.orgId),
        eq(journalLines.entryId, acme.openingBalanceEntryId!)
      )
    )
  expect(lines).toEqual(
    expect.arrayContaining([
      { partyId: acme.id, debit: 50_000_00n, credit: 0n },
      { partyId: null, debit: 0n, credit: 50_000_00n },
    ])
  )
  // Corrected by reversal, like any entry.
  await reverseEntry(ctx, acme.openingBalanceEntryId!, { date: today })

  // In use (it has ledger lines): contact details change, the GSTIN can't.
  expect((await getParty(ctx, acme.id)).inUse).toBe(true)
  expect(
    await updateParty(ctx, acme.id, { email: "ap@acme.example" })
  ).toMatchObject({ email: "ap@acme.example", gstin: "27AAPCA1234F1ZV" })
  await expect(
    updateParty(ctx, acme.id, { gstin: "29AABCN5678K1ZT" })
  ).rejects.toMatchObject({ code: "CONFLICT" })

  // A vendor with no documents yet can change anything.
  const vendor = await createParty(ctx, {
    kind: "vendor",
    name: "Shree Estates",
    pan: "ABCPS1234E",
    stateCode: "27",
    defaultTdsSection: "194I(b)",
    msmeCategory: "micro",
    udyamNumber: "UDYAM-MH-01-0001234",
  })
  expect(vendor).toMatchObject({
    registrationType: "unregistered",
    pan: "ABCPS1234E",
  })
  expect(
    await updateParty(ctx, vendor.id, { name: "Shree Estates LLP" })
  ).toMatchObject({ name: "Shree Estates LLP" })

  // Archived: hidden from the list and can't be invoiced; restore brings it back.
  await setPartyArchived(ctx, acme.id, true)
  const listed = await listParties(ctx, null, { kind: "customer" })
  expect(listed.items.map((p) => p.id)).not.toContain(acme.id)
  const all = await listParties(ctx, null, {
    kind: "customer",
    includeArchived: true,
  })
  expect(all.items.map((p) => p.id)).toContain(acme.id)
  const invoice = {
    partyId: acme.id,
    invoiceDate: today,
    dueDate: today,
    lines: [
      {
        description: "Consulting",
        hsnSac: "998311",
        quantity: "1",
        unitPrice: 10_000_00n,
        gstRateBps: 1800 as const,
      },
    ],
  }
  await expect(createInvoice(ctx, invoice)).rejects.toMatchObject({
    code: "VALIDATION",
  })
  await setPartyArchived(ctx, acme.id, false)
  expect((await createInvoice(ctx, invoice)).total).toBe(11_800_00n)
})
