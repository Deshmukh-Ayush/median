import { sourceRecordSchema } from "@workspace/contracts"
import Papa from "papaparse"
import { describe, expect, it } from "vitest"

import {
  bankRowsToRecords,
  parseStatementDate,
  tableToBankRows,
  validateBankRows,
} from "./parse"

const table = (csv: string) =>
  Papa.parse<string[]>(csv, { skipEmptyLines: "greedy" }).data

// HDFC-style export: account details above the header, a summary below.
const hdfc = `Account No :,50200012345678
Statement From :,01/10/2026,To,31/10/2026
Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
02/10/26,NEFT CR-RAZORPAY SOFTWARE-UTR1,UTR1,02/10/26,,"1,15,640.00","2,15,640.00"
03/10/26,UPI-AWS INDIA-PAYMENT,4101,03/10/26,"11,800.00",,"2,03,840.00"
03/10/26,UPI-AWS INDIA-PAYMENT,4102,03/10/26,"11,800.00",,"1,92,040.00"
,,,,,,
Opening Balance,Dr Count,Cr Count,Debits,Credits,Closing Bal
`

describe("statement dates", () => {
  it("reads Indian day-first formats", () => {
    expect(parseStatementDate("02/10/26")).toBe("2026-10-02")
    expect(parseStatementDate("2-10-2026")).toBe("2026-10-02")
    expect(parseStatementDate("02-Oct-2026")).toBe("2026-10-02")
    expect(parseStatementDate("02 Oct 26")).toBe("2026-10-02")
    expect(parseStatementDate("2026-10-02")).toBe("2026-10-02")
    expect(parseStatementDate("31/02/2026")).toBeNull()
    expect(parseStatementDate("Opening")).toBeNull()
  })
})

describe("CSV statements", () => {
  it("finds the header below account details and skips summary lines", () => {
    const { rows, errors } = tableToBankRows(table(hdfc))
    expect(errors).toEqual([])
    expect(rows.map((r) => r.row)).toEqual([
      {
        date: "2026-10-02",
        description: "NEFT CR-RAZORPAY SOFTWARE-UTR1",
        reference: "UTR1",
        debit: null,
        credit: "115640.00",
        balance: "215640.00",
      },
      expect.objectContaining({ debit: "11800.00", credit: null }),
      expect.objectContaining({ debit: "11800.00", reference: "4102" }),
    ])
  })

  it("reads single amount columns with Dr/Cr", () => {
    const { rows } = tableToBankRows(
      table(
        "Txn Date,Description,Amount,Dr/Cr,Balance\n05-Oct-2026,Salary,50000.00,DR,1000.00\n06-Oct-2026,Refund,200,CR,1200\n"
      )
    )
    expect(rows.map((r) => [r.row.debit, r.row.credit])).toEqual([
      ["50000.00", null],
      [null, "200"],
    ])
  })

  it("reports unreadable rows and unknown layouts", () => {
    const { rows, errors } = tableToBankRows(
      table(
        "Date,Narration,Debit,Credit\n32/10/2026,X,10,\n03/10/2026,Y,abc,\n"
      )
    )
    expect(rows).toEqual([])
    expect(errors.map((e) => e.index)).toEqual([0, 1])
    expect(tableToBankRows(table("a,b\n1,2\n")).errors[0]?.message).toMatch(
      /Couldn't find/
    )
  })

  it("validates rows from PDF extraction the same way", () => {
    const { rows, errors } = validateBankRows([
      {
        date: "2026-10-02",
        description: "X",
        reference: null,
        debit: "10.00",
        credit: null,
        balance: null,
      },
      {
        date: "02 Oct",
        description: "Y",
        reference: null,
        debit: "1",
        credit: null,
        balance: null,
      },
    ])
    expect(rows).toHaveLength(1)
    expect(errors[0]?.index).toBe(1)
  })
})

describe("rule 12 dedupe", () => {
  const hashes = (csv: string, account = "conn_1") =>
    bankRowsToRecords(
      "bank-statement",
      account,
      tableToBankRows(table(csv)).rows
    ).records.map((r) => r.dedupeHash)

  it("builds valid bank_line records", () => {
    const { records } = bankRowsToRecords(
      "bank-statement",
      "conn_1",
      tableToBankRows(table(hdfc)).rows
    )
    for (const r of records)
      expect(sourceRecordSchema.safeParse(r).success).toBe(true)
    expect(records[0]).toMatchObject({
      kind: "bank_line",
      direction: "inflow",
      amountPaise: 1_15_640_00n,
      occurredAt: "2026-10-02T00:00:00+05:30",
    })
  })

  it("re-uploads produce the same keys; other accounts don't collide", () => {
    expect(hashes(hdfc)).toEqual(hashes(hdfc))
    expect(new Set(hashes(hdfc)).size).toBe(3)
    expect(hashes(hdfc, "conn_2")[0]).not.toBe(hashes(hdfc)[0])
  })

  it("separates identical rows without a balance by occurrence, so overlaps dedupe", () => {
    const head = "Date,Narration,Debit,Credit\n"
    const day1 = "01/10/2026,TEA,50.00,\n"
    const twice = "02/10/2026,TEA,50.00,\n02/10/2026,TEA,50.00,\n"
    const day3 = "03/10/2026,TEA,50.00,\n"
    const first = hashes(head + day1 + twice)
    const overlapping = hashes(head + twice + day3)
    expect(new Set(first).size).toBe(3)
    // The two identical rows on 2 Oct get the same keys in both files.
    expect(overlapping.slice(0, 2)).toEqual(first.slice(1, 3))
    expect(first).not.toContain(overlapping[2])
  })
})
