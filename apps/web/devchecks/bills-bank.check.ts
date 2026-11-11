import { afterEach, expect, it } from "vitest"

import { setDocumentStoreForTests } from "../src/server/integrations/document-store"
import { getBill, recordBillPayment } from "../src/server/services/bills"
import { connect, importFile } from "../src/server/services/connectors"
import { approvedLotusBill, billsOrgSetup } from "./bill-fixture"
import { freshDevOrg } from "./setup"

afterEach(() => setDocumentStoreForTests(null))

it("bank debits pay bills, and confirm payments recorded by hand", async () => {
  const ctx = await freshDevOrg("bills-bank")
  const { bankAccountId } = await billsOrgSetup(ctx)
  const { bill } = await approvedLotusBill(ctx)

  // ₹5,000 paid by hand on 5 Oct; the rest goes out on 20 Oct.
  const manual = await recordBillPayment(ctx, {
    billId: bill.id,
    bankAccountId,
    date: "2026-10-05",
    amount: 5_000_00n,
  })
  expect(manual.outstanding).toBe(6_800_00n)
  const conn = await connect(ctx, "bank-statement", {
    label: "HDFC current a/c",
    ledgerAccountId: bankAccountId,
  })
  const csv = [
    "Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance",
    // Confirms the payment above: linked, not booked again.
    "06/10/2026,NEFT DR-LOTUS PEAK CLOUD,N1,5000.00,,",
    // Names the bill: booked against it, bill paid.
    "20/10/2026,NEFT DR-LOTUS PEAK CLOUD-LPC/118,N2,6800.00,,",
  ].join("\n")
  const report = await importFile(
    ctx,
    "bank-statement",
    { kind: "text", fileName: "hdfc.csv", mimeType: "text/csv", text: csv },
    { connectionId: conn.id }
  )
  expect(report.matched?.map((m) => m.matchKind)).toEqual([
    "bill_payment",
    "bill_payment",
  ])
  expect(report.unmatched).toHaveLength(0)
  expect(await getBill(ctx, bill.id)).toMatchObject({
    settled: 11_800_00n,
    outstanding: 0n,
    status: "paid",
  })
})
