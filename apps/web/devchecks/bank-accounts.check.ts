import { and, eq, gt } from "drizzle-orm"
import { expect, it } from "vitest"

import { getDb } from "../src/server/db"
import { journalLines, sourceRecords } from "../src/server/db/schema"
import { setRazorpayClientOptionsForTests } from "../src/server/integrations/razorpay/connector"
import {
  createBankAccount,
  listLedgerAccounts,
} from "../src/server/services/accounts"
import {
  connect,
  syncConnection,
  updateConnectionSettings,
} from "../src/server/services/connectors"
import { devOrg } from "./setup"

it("bank sub-accounts and the Razorpay settlement bank", async () => {
  const ctx = await devOrg()
  const run = `ba${Math.floor(Date.now() / 1000)}`
  const icici = await createBankAccount(ctx, {
    name: `ICICI current ${run}`,
    bankName: "ICICI Bank",
    last4: "4321",
  })
  console.log("created", icici)
  expect(icici).toMatchObject({
    isBank: true,
    bankName: "ICICI Bank",
    accountLast4: "4321",
    type: "asset",
  })
  expect(icici.code).toMatch(/^111[1-9]$|^111\d\d$/)
  await expect(
    createBankAccount(
      { ...ctx, role: "ca" },
      { name: "x", bankName: "y", last4: "1234" }
    )
  ).rejects.toMatchObject({ code: "FORBIDDEN" })
  await expect(
    createBankAccount(ctx, { name: "x", bankName: "y", last4: "12a4" })
  ).rejects.toMatchObject({ code: "VALIDATION" })
  const banks = await listLedgerAccounts(ctx, null, { bankOnly: true })
  console.log(banks.items.map((b) => `${b.code} ${b.name}`))

  const now = Math.floor(Date.now() / 1000)
  const p = {
    id: `pay_${run}`,
    entity: "payment",
    amount: 118_000,
    currency: "INR",
    status: "captured",
    order_id: null,
    invoice_id: null,
    method: "upi",
    amount_refunded: 0,
    captured: true,
    description: null,
    email: null,
    contact: null,
    notes: [],
    fee: 2_360,
    tax: 360,
    created_at: now - 86_400 * 2,
  }
  const s = {
    id: `setl_${run}`,
    entity: "settlement",
    amount: 115_640,
    status: "processed",
    fees: 2_360,
    tax: 360,
    utr: `UTR${run}`,
    created_at: now - 86_400,
  }
  const recon = [
    {
      entity_id: p.id,
      type: "payment",
      debit: 0,
      credit: 115_640,
      amount: 118_000,
      currency: "INR",
      fee: 2_360,
      tax: 360,
      settled: true,
      settlement_id: s.id,
      settlement_utr: s.utr,
      created_at: p.created_at,
      settled_at: s.created_at,
    },
  ]
  setRazorpayClientOptionsForTests({
    sleep: () => Promise.resolve(),
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const first = Number(url.searchParams.get("skip") ?? 0) === 0
      const items = !first
        ? []
        : url.pathname.endsWith("/recon/combined")
          ? recon
          : url.pathname.endsWith("/payments")
            ? [p]
            : url.pathname.endsWith("/settlements")
              ? [s]
              : []
      return Promise.resolve(
        new Response(
          JSON.stringify({ entity: "collection", count: items.length, items }),
          { status: 200 }
        )
      )
    },
  })
  const conn = await connect(ctx, "razorpay-test-keys", {
    keyId: `rzp_test_${run}`,
    keySecret: "devcheck-secret-123",
  })
  await expect(
    updateConnectionSettings(ctx, conn.id, {
      settlementBankAccountId:
        banks.items.find((b) => b.code === "1200")?.id ??
        "00000000-0000-4000-8000-000000000000",
    })
  ).rejects.toMatchObject({ code: "VALIDATION" })
  const updated = await updateConnectionSettings(ctx, conn.id, {
    settlementBankAccountId: icici.id,
    feeGstStateCode: "27",
  })
  expect(updated).toMatchObject({
    settlementBankAccountId: icici.id,
    feeGstStateCode: "27",
  })
  const result = await syncConnection(ctx, conn.id)
  console.log("sync", result)
  const db = getDb()
  const [setl] = await db
    .select({ entry: sourceRecords.journalEntryId })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.organizationId, ctx.orgId),
        eq(sourceRecords.externalId, s.id)
      )
    )
  const debit = await db
    .select({ account: journalLines.accountId })
    .from(journalLines)
    .where(
      and(
        eq(journalLines.organizationId, ctx.orgId),
        eq(journalLines.entryId, setl!.entry!),
        gt(journalLines.debitPaise, 0n)
      )
    )
  expect(debit.map((d) => d.account)).toEqual([icici.id])
})
