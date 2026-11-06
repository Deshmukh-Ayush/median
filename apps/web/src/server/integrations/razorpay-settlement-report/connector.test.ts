import { sourceRecordSchema } from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import { parseReportTime, parseSettlementReport } from "./connector"

const header =
  "entity_id,type,debit,credit,amount,currency,fee,tax,on_hold,settled,created_at,settled_at,settlement_id,description,notes,payment_id,settlement_utr,order_id,method"
const csv = (...rows: string[]) => ({
  kind: "text" as const,
  fileName: "settlements.csv",
  mimeType: "text/csv",
  text: [header, ...rows].join("\n") + "\n",
})

describe("Razorpay settlement report", () => {
  it("produces the same records as the API, linked to their settlement", async () => {
    const { records, errors } = await parseSettlementReport(
      csv(
        `pay_A,payment,0,"1,156.40","1,180.00",INR,23.60,3.60,0,1,2026-11-02 10:00:00,2026-11-04 09:00:00,setl_X,,,,UTR9,order_1,upi`,
        `rfnd_B,refund,100.00,0,100.00,INR,0,0,0,1,2026-11-03 10:00:00,2026-11-04 09:00:00,setl_X,,,pay_A,UTR9,,`
      )
    )
    expect(errors).toEqual([])
    expect(records.map((r) => [r.kind, r.externalId, r.amountPaise])).toEqual([
      ["payment", "pay_A", 1_18_000n],
      ["fee", "pay_A:fee", 2_360n],
      ["refund", "rfnd_B", 10_000n],
      ["settlement", "setl_X", 1_05_640n],
    ])
    for (const r of records) {
      expect(sourceRecordSchema.safeParse(r).success).toBe(true)
      expect(r.settlementExternalId).toBe("setl_X")
    }
    expect(records[0]?.occurredAt).toBe("2026-11-02T04:30:00.000Z")
    expect(records[3]).toMatchObject({
      reference: "UTR9",
      payload: { recon: "available", status: "processed" },
    })
  })

  it("reports unreadable and unsupported rows without throwing", async () => {
    const { records, errors } = await parseSettlementReport(
      csv(
        `pay_A,payment,0,x,1180,INR,0,0,0,1,2026-11-02 10:00:00,,setl_X,,,,,,`,
        `adj_C,adjustment,0,5,5,INR,0,0,0,1,2026-11-02 10:00:00,,setl_X,,,,,,`
      )
    )
    expect(errors.map((e) => e.index)).toEqual([0, 1])
    expect(records).toEqual([])
  })

  it("rejects files that aren't settlement reports", async () => {
    const result = await parseSettlementReport({
      kind: "text",
      fileName: "x.csv",
      mimeType: "text/csv",
      text: "date,amount\n2026-01-01,5\n",
    })
    expect(result.errors[0]?.message).toMatch(/settlement report/)
  })

  it("reads IST, ISO and Unix timestamps", () => {
    const expected = Date.parse("2026-11-02T04:30:00Z") / 1000
    expect(parseReportTime("2026-11-02 10:00:00")).toBe(expected)
    expect(parseReportTime("02/11/2026 10:00:00")).toBe(expected)
    expect(parseReportTime("2026-11-02T10:00:00+05:30")).toBe(expected)
    expect(parseReportTime(String(expected))).toBe(expected)
    expect(parseReportTime("yesterday")).toBeNull()
  })
})
