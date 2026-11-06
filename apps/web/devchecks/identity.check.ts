import { eq, sql } from "drizzle-orm"
import { expect, it } from "vitest"
import { getDb } from "../src/server/db"
import { journalEntries } from "../src/server/db/schema"
import { setRazorpayClientOptionsForTests } from "../src/server/integrations/razorpay/connector"
import {
  connect,
  importFile,
  syncConnection,
} from "../src/server/services/connectors"
import { devOrg } from "./setup"

function scenario(tag: string) {
  const now = Math.floor(Date.now() / 1000)
  const run = `${tag}${now}`
  const pay = (n: number) => ({
    id: `pay_${run}${n}`,
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
    created_at: now - 86_400 * 2 + n,
  })
  const payments = [pay(1), pay(2)]
  const setl = {
    id: `setl_${run}`,
    entity: "settlement",
    amount: 2 * (118_000 - 2_360),
    status: "processed",
    fees: 4_720,
    tax: 720,
    utr: `UTR${run}`,
    created_at: now - 86_400,
  }
  const recon = payments.map((p) => ({
    entity_id: p.id,
    type: "payment",
    debit: 0,
    credit: 115_640,
    amount: 118_000,
    currency: "INR",
    fee: 2_360,
    tax: 360,
    settled: true,
    settlement_id: setl.id,
    settlement_utr: setl.utr,
    created_at: p.created_at,
    settled_at: setl.created_at,
  }))
  const json = (b: unknown) =>
    new Response(JSON.stringify(b), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
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
            ? payments
            : url.pathname.endsWith("/settlements")
              ? [setl]
              : []
      return Promise.resolve(
        json({ entity: "collection", count: items.length, items })
      )
    },
  })
  const ist = (s: number) =>
    new Date((s + 19_800) * 1000).toISOString().replace("T", " ").slice(0, 19)
  const csv = [
    "entity_id,type,debit,credit,amount,currency,fee,tax,settlement_id,settlement_utr,created_at,settled_at",
    ...payments.map(
      (p) =>
        `${p.id},payment,0,1156.40,1180.00,INR,23.60,3.60,${setl.id},${setl.utr},${ist(p.created_at)},${ist(setl.created_at)}`
    ),
  ].join("\n")
  return {
    run,
    file: {
      kind: "text",
      fileName: "r.csv",
      mimeType: "text/csv",
      text: csv,
    } as const,
  }
}

const entryCount = async (orgId: string) => {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(eq(journalEntries.organizationId, orgId))
  return r?.n ?? 0
}

it("API sync then report upload books nothing twice", async () => {
  const ctx = await devOrg()
  const s = scenario("a")
  const conn = await connect(ctx, "razorpay-test-keys", {
    keyId: `rzp_test_${s.run}`,
    keySecret: "devcheck-secret-123",
  })
  const before = await entryCount(ctx.orgId)
  const sync = await syncConnection(ctx, conn.id)
  const afterSync = await entryCount(ctx.orgId)
  console.log("api sync", sync, "entries +", afterSync - before)
  expect(sync.posted).toBe(5) // 2 payments, 2 fees, 1 settlement
  const imp = await importFile(ctx, "razorpay-settlement-report", s.file)
  console.log("report after api", imp)
  expect(imp.imported).toBe(0)
  expect(imp.posted).toBe(0)
  expect(await entryCount(ctx.orgId)).toBe(afterSync)
})

it("report upload then API sync books nothing twice", async () => {
  const ctx = await devOrg()
  const s = scenario("b")
  const before = await entryCount(ctx.orgId)
  const imp = await importFile(ctx, "razorpay-settlement-report", s.file)
  const afterImport = await entryCount(ctx.orgId)
  console.log("report first", imp, "entries +", afterImport - before)
  expect(imp.posted).toBe(5)
  const conn = await connect(ctx, "razorpay-test-keys", {
    keyId: `rzp_test_${s.run}`,
    keySecret: "devcheck-secret-123",
  })
  const sync = await syncConnection(ctx, conn.id)
  console.log("api after report", sync)
  expect(sync.inserted).toBe(0)
  expect(sync.posted).toBe(0)
  expect(await entryCount(ctx.orgId)).toBe(afterImport)
})
