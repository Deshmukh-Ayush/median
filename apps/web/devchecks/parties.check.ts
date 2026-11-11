import { expect, it } from "vitest"

import {
  createParty,
  findPartyByGstin,
  listParties,
} from "../src/server/services/parties"
import { freshDevOrg } from "./setup"

it("customers and vendors: GSTIN checks and derived details", async () => {
  const ctx = await freshDevOrg("parties")

  // A typo in the GSTIN is caught; a valid one fills state, PAN and type.
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
    legalName: "Acme Retail Private Limited",
    gstin: "27AAPCA1234F1ZV",
    billingAddress: "12 MG Road, Pune 411001",
    paymentTermsDays: 30,
  })
  expect(acme).toMatchObject({
    stateCode: "27",
    pan: "AAPCA1234F",
    registrationType: "regular",
    paymentTermsDays: 30,
    archivedAt: null,
  })
  expect(await findPartyByGstin(ctx, "27AAPCA1234F1ZV")).toMatchObject({
    id: acme.id,
  })

  // An unregistered vendor with a PAN, TDS section and MSME details.
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
    defaultTdsSection: "194I(b)",
    msmeCategory: "micro",
  })
  await expect(
    createParty(ctx, {
      kind: "customer",
      name: "Globex",
      defaultTdsSection: "194C",
    })
  ).rejects.toMatchObject({ code: "VALIDATION" })

  const customers = await listParties(ctx, null, { kind: "customer" })
  expect(customers.items.map((p) => p.id)).toEqual([acme.id])
})
