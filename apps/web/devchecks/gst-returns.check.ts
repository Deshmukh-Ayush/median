import { eq } from "drizzle-orm"
import { expect, it } from "vitest"
import { gstr1PayloadSchema } from "@workspace/contracts"
import { getDb } from "../src/server/db"
import { organizationSettings } from "../src/server/db/schema"
import { createCreditNote } from "../src/server/services/credit-notes"
import { exportGstr1, getGstSummary } from "../src/server/services/gst"
import { createInvoice } from "../src/server/services/invoices"
import { createParty } from "../src/server/services/parties"
import { istDateOf } from "../src/server/services/posting-rules"
import { freshDevOrg } from "./setup"

it("GST summary and GSTR-1 draft from real invoices and a credit note", async () => {
  const ctx = await freshDevOrg("gst")
  const db = getDb()
  await expect(
    exportGstr1(ctx, istDateOf(new Date()).slice(0, 7))
  ).rejects.toMatchObject({ code: "VALIDATION" })
  await db
    .update(organizationSettings)
    .set({ gstRegistered: true, gstin: "29ABCDE1234F1ZW", stateCode: "29" })
    .where(eq(organizationSettings.organizationId, ctx.orgId))

  const today = istDateOf(new Date())
  const period = today.slice(0, 7)
  const registered = await createParty(ctx, {
    kind: "customer",
    name: "Registered Co",
    gstin: "29AAPFU0939F1ZR",
  })
  const consumer = await createParty(ctx, {
    kind: "customer",
    name: "Consumer",
    stateCode: "27",
  })
  const line = (unitPrice: bigint) => ({
    description: "Growth plan",
    hsnSac: "998314",
    quantity: "1",
    unitPrice,
    gstRateBps: 1800 as const,
  })
  const b2b = await createInvoice(ctx, {
    partyId: registered.id,
    invoiceDate: today,
    dueDate: today,
    lines: [line(10_000_00n)],
  })
  await createInvoice(ctx, {
    partyId: consumer.id,
    invoiceDate: today,
    dueDate: today,
    lines: [line(5_000_00n)],
  })
  await createCreditNote(ctx, {
    invoiceId: b2b.id,
    creditNoteDate: today,
    reason: "post_sale_discount",
    lines: [{ invoiceLineId: b2b.lines[0]!.id, taxable: 1_000_00n }],
  })

  const s = await getGstSummary(ctx, period)
  console.log("summary", s)
  // 10,000 intrastate (CGST/SGST 900 each), 5,000 to Maharashtra (IGST 900),
  // credit note 1,000 (CGST/SGST 90 each).
  expect(s.outputTax).toMatchObject({
    igst: 900_00n,
    cgst: 810_00n,
    sgst: 810_00n,
  })
  expect(s.unexplainedOutputTax.total).toBe(0n)
  expect(s.netPayable.total).toBe(2_520_00n)
  expect(s.outwardTotal.taxable).toBe(14_000_00n)
  expect(s.isLocked).toBe(false)

  const g = await exportGstr1(ctx, period)
  console.log("gstr1", JSON.stringify(g.payload), g.warnings)
  expect(gstr1PayloadSchema.safeParse(g.payload).success).toBe(true)
  expect(g.payload.b2b[0]?.ctin).toBe("29AAPFU0939F1ZR")
  expect(g.payload.b2cs[0]).toMatchObject({ sply_ty: "INTER", pos: "27" })
  expect(g.payload.cdnr[0]?.nt[0]?.val).toBe(1180)
})
