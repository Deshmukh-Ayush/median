// Times the Razorpay settlement-report import and checks what it books.
// SIZES is what runs by default; add 500 locally to measure a big file.

import { and, eq, sql } from "drizzle-orm"
import { expect, it } from "vitest"

import { getDb } from "../src/server/db"
import { sourceRecords } from "../src/server/db/schema"
import { importFile } from "../src/server/services/connectors"
import { freshDevOrg } from "./setup"

const SIZES = [12]

/** N payments of ₹1,000 (2% fee + 18% GST on it) in one settlement. */
function report(n: number, tag: string): string {
  const header =
    "entity_id,type,debit,credit,amount,currency,fee,tax,on_hold,settled,created_at,settled_at,settlement_id,description,notes,payment_id,settlement_utr,order_id,method"
  const rows = Array.from({ length: n }, (_, i) => {
    const id = `pay_${tag}${String(i).padStart(5, "0")}`
    return `${id},payment,0,976.40,1000.00,INR,23.60,3.60,0,1,2026-11-01 10:00:00,2026-11-04 09:00:00,setl_${tag},,,,UTR${tag},order_${i},upi`
  })
  return [header, ...rows].join("\n")
}

it.each(SIZES)(
  "imports a %i-payment settlement report",
  async (n) => {
    const ctx = await freshDevOrg(`perf${n}`)
    const tag = `P${n}x${Date.now().toString(36)}`
    const started = performance.now()
    const result = await importFile(ctx, "razorpay-settlement-report", {
      kind: "text",
      fileName: "settlements.csv",
      mimeType: "text/csv",
      text: report(n, tag),
    })
    const seconds = (performance.now() - started) / 1000
    console.log(
      `[perf] ${n} payments: ${seconds.toFixed(1)}s, ${result.imported} imported, ${result.posted} posted`
    )
    // A payment and a fee per row, and the settlement; nothing to the inbox.
    expect(result.posted).toBe(2 * n + 1)
    const [posted] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.organizationId, ctx.orgId),
          eq(sourceRecords.status, "posted")
        )
      )
    expect(posted?.n).toBe(2 * n + 1)
  },
  1_800_000
)
