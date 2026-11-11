import { and, desc, eq } from "drizzle-orm"
import { expect, it } from "vitest"
import { getDb } from "../src/server/db"
import {
  inboxItems,
  ledgerAccounts,
  organizationSettings,
  sourceRecords,
} from "../src/server/db/schema"
import { connect, importFile } from "../src/server/services/connectors"
import {
  approveInboxItem,
  listInboxItems,
  rejectInboxItem,
} from "../src/server/services/inbox"
import { freshDevOrg } from "./setup"

it("bank statement import, matching and inbox on the dev DB", async () => {
  // A fresh org per run with its own Razorpay settlement, so leftovers from
  // earlier runs (an already-matched settlement) can't break it.
  const ctx = await freshDevOrg("bank")
  const db = getDb()
  await db
    .update(organizationSettings)
    .set({
      gstRegistered: true,
      gstin: "29ABCDE1234F1ZW",
      stateCode: "29",
      defaultGstRateBps: 1800,
    })
    .where(eq(organizationSettings.organizationId, ctx.orgId))
  const tag = `b${Date.now()}`
  const report = await importFile(ctx, "razorpay-settlement-report", {
    kind: "text",
    fileName: "settlements.csv",
    mimeType: "text/csv",
    text: [
      "entity_id,type,debit,credit,amount,currency,fee,tax,settlement_id,settlement_utr,created_at,settled_at,payment_id",
      `pay_${tag},payment,0,1156.40,1180.00,INR,23.60,3.60,setl_${tag},UTR${tag},2026-11-02 10:00:00,2026-11-04 09:00:00,`,
    ].join("\n"),
  })
  console.log("settlement report", report)
  const [bank] = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.organizationId, ctx.orgId),
        eq(ledgerAccounts.systemKey, "bank_default")
      )
    )
  const conn = await connect(ctx, "bank-statement", {
    label: "HDFC current a/c",
    ledgerAccountId: bank!.id,
  })
  // The settlement this run just imported.
  const [setl] = await db
    .select({
      ext: sourceRecords.externalId,
      amount: sourceRecords.amountPaise,
      at: sourceRecords.occurredAt,
      utr: sourceRecords.reference,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.organizationId, ctx.orgId),
        eq(sourceRecords.kind, "settlement"),
        eq(sourceRecords.status, "posted"),
        eq(sourceRecords.externalId, `setl_${tag}`)
      )
    )
    .orderBy(desc(sourceRecords.occurredAt))
    .limit(1)
  const d = new Date(setl!.at.getTime() + 19_800_000 + 86_400_000)
  const date = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`
  const rupees = (p: bigint) =>
    `${p / 100n}.${String(p % 100n).padStart(2, "0")}`
  const stamp = Date.now()
  const csv = [
    "Account No :,5020001234",
    "Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance",
    `${date},NEFT CR-RAZORPAY-${setl!.utr},${setl!.utr},,${rupees(setl!.amount)},${stamp}.00`,
    `${date},UPI-UNKNOWN SHOP ${stamp},77,1234.50,,${stamp - 1}.00`,
    `${date},CHAI ${stamp},,50.00,,`,
    `${date},CHAI ${stamp},,50.00,,`,
    `31/02/2026,BAD DATE,,1.00,,`,
  ].join("\n")
  const file = {
    kind: "text",
    fileName: "hdfc.csv",
    mimeType: "text/csv",
    text: csv,
  } as const
  const first = await importFile(ctx, "bank-statement", file, {
    connectionId: conn.id,
  })
  console.log("first import", JSON.stringify(first, null, 1))
  expect(first.matched?.[0]?.matchKind).toBe("razorpay_settlement")
  expect(first.unmatched).toHaveLength(3)
  expect(first.errors).toHaveLength(1)
  const again = await importFile(ctx, "bank-statement", file, {
    connectionId: conn.id,
  })
  console.log("re-import", again)
  expect(again.imported).toBe(0)
  expect(again.duplicates).toBe(4)

  const page = await listInboxItems(
    ctx,
    null,
    { kind: "bank_line" },
    { limit: 2 }
  )
  const page2 = await listInboxItems(
    ctx,
    page.nextCursor,
    { kind: "bank_line" },
    { limit: 2 }
  )
  console.log(
    page.items.map((i) => [
      i.reason,
      i.proposedEntry.lines.map(
        (l) => `${l.accountName} ${l.debit}/${l.credit}`
      ),
    ]),
    page2.items.length
  )
  const [a, b] = page.items
  const approved = await approveInboxItem(ctx, a!.id, {
    narration: "Approved in devcheck",
  })
  console.log("approved", approved.entryId, approved.item.status)
  await expect(approveInboxItem(ctx, a!.id)).rejects.toMatchObject({
    code: "CONFLICT",
  })
  const rejected = await rejectInboxItem(ctx, b!.id, "Personal expense")
  expect(rejected.status).toBe("rejected")
  const [rec] = await db
    .select({ status: sourceRecords.status })
    .from(sourceRecords)
    .innerJoin(inboxItems, eq(inboxItems.sourceId, sourceRecords.id))
    .where(eq(inboxItems.id, a!.id))
  expect(rec?.status).toBe("posted")
})
