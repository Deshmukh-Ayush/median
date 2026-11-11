import { describe, expect, it } from "vitest"
import { checkedGstinSchema, gstinCheckCharOk } from "@workspace/contracts"

import { assertLockedFieldsUnchanged, resolvePartyFields } from "./party-rules"

// Valid check characters (computed, not real businesses).
const ACME = "27AAPCA1234F1ZV"
const NORTHWIND = "29AABCN5678K1ZT"

describe("GSTIN check character", () => {
  it("accepts valid GSTINs and rejects a one-character typo", () => {
    expect(gstinCheckCharOk(ACME)).toBe(true)
    expect(gstinCheckCharOk(NORTHWIND)).toBe(true)
    expect(gstinCheckCharOk("27AAPCA1234F1Z5")).toBe(false)
    expect(checkedGstinSchema.safeParse("27aapca1234f1zv").success).toBe(true)
    expect(checkedGstinSchema.safeParse("27AAPCA1234F1Z5").success).toBe(false)
  })
})

describe("resolvePartyFields", () => {
  it("derives state, PAN and regular registration from a GSTIN", () => {
    const p = resolvePartyFields("customer", { name: "Acme", gstin: ACME })
    expect(p).toMatchObject({
      gstin: ACME,
      stateCode: "27",
      pan: "AAPCA1234F",
      registrationType: "regular",
    })
  })

  it("makes a party without a GSTIN unregistered, keeping its state", () => {
    const p = resolvePartyFields("customer", { name: "Rahul", stateCode: "29" })
    expect(p).toMatchObject({
      registrationType: "unregistered",
      stateCode: "29",
    })
  })

  it("rejects a state or PAN that contradicts the GSTIN", () => {
    expect(() =>
      resolvePartyFields("customer", {
        name: "A",
        gstin: ACME,
        stateCode: "29",
      })
    ).toThrow(/State code/)
    expect(() =>
      resolvePartyFields("vendor", {
        name: "A",
        gstin: ACME,
        pan: "AABCN5678K",
      })
    ).toThrow(/PAN/)
  })

  it("needs a GSTIN for regular, composition and SEZ, and none otherwise", () => {
    expect(() =>
      resolvePartyFields("vendor", { name: "A", registrationType: "sez" })
    ).toThrow(/GSTIN is needed/)
    expect(() =>
      resolvePartyFields("vendor", {
        name: "A",
        gstin: ACME,
        registrationType: "unregistered",
      })
    ).toThrow(/don't have a GSTIN/)
  })

  it("gives overseas parties no Indian state", () => {
    expect(
      resolvePartyFields("customer", {
        name: "Globex Inc",
        registrationType: "overseas",
      })
    ).toMatchObject({ stateCode: null, gstin: null })
    expect(() =>
      resolvePartyFields("customer", {
        name: "Globex Inc",
        registrationType: "overseas",
        stateCode: "27",
      })
    ).toThrow(/Overseas/)
  })

  it("keeps a typed PAN for an unregistered vendor", () => {
    expect(
      resolvePartyFields("vendor", { name: "Freelancer", pan: "ABCPD1234E" })
    ).toMatchObject({ pan: "ABCPD1234E", registrationType: "unregistered" })
  })

  it("allows a default TDS section only on vendors", () => {
    expect(
      resolvePartyFields("vendor", {
        name: "Law firm",
        defaultTdsSection: "194J(b)",
      }).defaultTdsSection
    ).toBe("194J(b)")
    expect(() =>
      resolvePartyFields("customer", {
        name: "A",
        defaultTdsSection: "194C",
      })
    ).toThrow(/Only vendors/)
  })

  it("on edit, keeps stored fields the input leaves out", () => {
    const base = resolvePartyFields("customer", {
      name: "Acme",
      gstin: ACME,
      email: "ap@acme.example",
      paymentTermsDays: 30,
    })
    const edited = resolvePartyFields(
      "customer",
      { phone: "+91 98200 00000" },
      base
    )
    expect(edited).toMatchObject({
      gstin: ACME,
      stateCode: "27",
      email: "ap@acme.example",
      paymentTermsDays: 30,
      phone: "+91 98200 00000",
    })
    expect(
      resolvePartyFields("customer", { email: null }, base).email
    ).toBeNull()
  })

  it("on edit, a new GSTIN replaces the derived state and PAN", () => {
    const base = resolvePartyFields("customer", { name: "Acme", gstin: ACME })
    expect(
      resolvePartyFields("customer", { gstin: NORTHWIND }, base)
    ).toMatchObject({ stateCode: "29", pan: "AABCN5678K" })
    expect(resolvePartyFields("customer", { gstin: null }, base)).toMatchObject(
      { registrationType: "unregistered", pan: null, stateCode: null }
    )
  })
})

describe("assertLockedFieldsUnchanged", () => {
  const base = resolvePartyFields("customer", { name: "Acme", gstin: ACME })

  it("allows contact and terms edits on a party in use", () => {
    const after = resolvePartyFields(
      "customer",
      { email: "x@acme.example", paymentTermsDays: 45 },
      base
    )
    expect(() => assertLockedFieldsUnchanged(base, after)).not.toThrow()
  })

  it("refuses a new name or GSTIN on a party in use", () => {
    for (const patch of [{ name: "Acme 2" }, { gstin: NORTHWIND }]) {
      const after = resolvePartyFields("customer", patch, base)
      expect(() => assertLockedFieldsUnchanged(base, after)).toThrow(
        expect.objectContaining({ code: "CONFLICT" })
      )
    }
  })
})
