import { eq } from "drizzle-orm"
import { expect, it } from "vitest"

import { getDb } from "../src/server/db"
import { organizationSettings } from "../src/server/db/schema"
import { invoiceDocument } from "../src/server/pdf/invoice-document"
import {
  createCreditNote,
  getCreditNote,
} from "../src/server/services/credit-notes"
import { exportGstr1 } from "../src/server/services/gst"
import { createInvoice, getInvoice } from "../src/server/services/invoices"
import { createParty, updateParty } from "../src/server/services/parties"
import { istDateOf } from "../src/server/services/posting-rules"
import { freshDevOrg } from "./setup"

/** The invoice PDF minus its creation timestamp and file ID, which vary per render. */
async function pdfText(
  invoice: Parameters<typeof invoiceDocument>[0]["invoice"]
) {
  const pdf = await import("@react-pdf/renderer")
  const buffer = await pdf.renderToBuffer(
    invoiceDocument({
      pdf,
      invoice,
      supplier: {
        name: "Snapshot Labs",
        gstin: "27AAHCM4321Q1Z2",
        stateCode: "27",
      },
    })
  )
  return buffer
    .toString("latin1")
    .replace(/\(D:\d{14}Z\)/g, "")
    .replace(/\/ID \[[^\]]*\]/g, "")
}

it("an issued invoice keeps the customer it was issued to", async () => {
  const ctx = await freshDevOrg("snapshot")
  await getDb()
    .update(organizationSettings)
    .set({
      gstRegistered: true,
      gstin: "27AAHCM4321Q1Z2",
      stateCode: "27",
      compositionScheme: false,
    })
    .where(eq(organizationSettings.organizationId, ctx.orgId))
  const today = istDateOf(new Date())

  const acme = await createParty(ctx, {
    kind: "customer",
    name: "Acme",
    legalName: "Acme Retail Private Limited",
    gstin: "27AAPCA1234F1ZV",
    billingAddress: "12 MG Road, Pune 411001",
  })
  const issued = await createInvoice(ctx, {
    partyId: acme.id,
    invoiceDate: today,
    dueDate: today,
    lines: [
      {
        description: "Consulting",
        hsnSac: "998311",
        quantity: "1",
        unitPrice: 10_000_00n,
        gstRateBps: 1800,
      },
    ],
  })
  expect(issued.party).toEqual({
    id: acme.id,
    name: "Acme Retail Private Limited",
    gstin: "27AAPCA1234F1ZV",
    address: "12 MG Road, Pune 411001",
    stateCode: "27",
  })
  const note = await createCreditNote(ctx, {
    invoiceId: issued.id,
    creditNoteDate: today,
    reason: "post_sale_discount",
    lines: [{ invoiceLineId: issued.lines[0]!.id, taxable: 1_000_00n }],
  })
  // Read back after the credit note, which changes what's credited.
  const before = (await getInvoice(ctx, issued.id))!
  const pdfBefore = await pdfText(before)
  const gstr1Before = await exportGstr1(ctx, today.slice(0, 7))
  expect(gstr1Before.payload.b2b[0]?.ctin).toBe("27AAPCA1234F1ZV")

  // The customer re-registers in Karnataka and moves.
  await updateParty(ctx, acme.id, {
    name: "Acme South",
    legalName: "Acme South Private Limited",
    gstin: "29AABCN5678K1ZT",
    billingAddress: "1 Residency Road, Bengaluru 560025",
  })

  const after = await getInvoice(ctx, issued.id)
  expect(after).toEqual(before)
  expect((await getCreditNote(ctx, note.id))?.party).toEqual(issued.party)
  expect(await pdfText(after!)).toBe(pdfBefore)
  expect((await exportGstr1(ctx, today.slice(0, 7))).payload).toEqual(
    gstr1Before.payload
  )

  // The next invoice is issued to the customer as they are now.
  const next = await createInvoice(ctx, {
    partyId: acme.id,
    invoiceDate: today,
    dueDate: today,
    lines: [
      {
        description: "Consulting",
        hsnSac: "998311",
        quantity: "1",
        unitPrice: 10_000_00n,
        gstRateBps: 1800,
      },
    ],
  })
  expect(next).toMatchObject({
    party: { name: "Acme South Private Limited", gstin: "29AABCN5678K1ZT" },
    supplyType: "interstate",
  })
})
