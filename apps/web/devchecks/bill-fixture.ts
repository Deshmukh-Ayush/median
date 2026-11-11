// A vendor bill approved from the inbox, for dev checks. Synthetic data only.

import { and, eq } from "drizzle-orm"

import { getDb } from "../src/server/db"
import { ledgerAccounts, organizationSettings } from "../src/server/db/schema"
import { setDocumentStoreForTests } from "../src/server/integrations/document-store"
import { listBills } from "../src/server/services/bills"
import type { OrgContext } from "../src/server/services/context"
import { registerDocument } from "../src/server/services/documents"
import { createInboxItemFromExtraction } from "../src/server/services/extraction"
import { approveInboxItem } from "../src/server/services/inbox"
import { createParty } from "../src/server/services/parties"

/** A GST-registered org (Karnataka), an in-memory document store, its bank. */
export async function billsOrgSetup(ctx: OrgContext) {
  const db = getDb()
  await db
    .update(organizationSettings)
    .set({
      gstRegistered: true,
      gstin: "29ABCDE1234F1ZW",
      stateCode: "29",
      compositionScheme: false,
    })
    .where(eq(organizationSettings.organizationId, ctx.orgId))
  setDocumentStoreForTests({
    put: (p) => Promise.resolve({ pathname: p }),
    get: () => Promise.resolve(null),
    delete: () => Promise.resolve(),
    deletePrefix: () => Promise.resolve(0),
  })
  const [bank] = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.organizationId, ctx.orgId),
        eq(ledgerAccounts.code, "1110")
      )
    )
  return { bankAccountId: bank!.id }
}

/** Lotus Peak Cloud (micro MSME) and its bill LPC/118 for ₹11,800, approved. */
export async function approvedLotusBill(ctx: OrgContext) {
  const vendor = await createParty(ctx, {
    kind: "vendor",
    name: "Lotus Peak Cloud",
    gstin: "27AAPCA1234F1ZV",
    msmeCategory: "micro",
  })
  const doc = await registerDocument(ctx, {
    kind: "bill",
    file: new File([`%PDF-1.7\n% bills ${Date.now()}\n`], "bill.pdf"),
  })
  const item = await createInboxItemFromExtraction(ctx, doc.id, {
    vendor: {
      name: "Lotus Peak Cloud",
      gstin: "27AAPCA1234F1ZV",
      stateCode: "27",
    },
    billNumber: "LPC/118",
    billDate: "2026-09-01",
    dueDate: "2026-09-30",
    placeOfSupplyStateCode: "29",
    currency: "INR",
    lines: [
      {
        description: "Hosting",
        hsnSac: "998315",
        quantity: "1",
        taxableAmount: "10,000.00",
        gstRatePercent: "18",
      },
    ],
    printedTotals: {
      taxable: "10,000.00",
      cgst: null,
      sgst: null,
      igst: "1,800.00",
      total: "11,800.00",
    },
  })
  await approveInboxItem(ctx, item.id)
  const bill = (await listBills(ctx, null, { partyId: vendor.id })).items[0]!
  return { vendor, bill }
}
