import { describe, expect, it } from "vitest"

import { closingBalances, readTally } from "../integrations/tally-import/tally"
import {
  mastersXml,
  tallyAmount,
  tallyGroupOf,
  uniqueNames,
  voucherTypeOf,
  vouchersXml,
} from "./tally-export"

describe("tally export", () => {
  it("formats amounts with Tally's sign", () => {
    expect(tallyAmount(12345n)).toBe("-123.45")
    expect(tallyAmount(-5n)).toBe("0.05")
    expect(tallyAmount(0n)).toBe("0.00")
  })

  it("puts accounts under Tally's primary groups", () => {
    const g = (
      code: string,
      type: "asset" | "liability" | "equity" | "income" | "expense",
      systemKey: string | null = null,
      isBank = false
    ) => tallyGroupOf({ code, name: "x", type, systemKey, isBank })
    expect(g("1110", "asset", "bank_default", true)).toBe("Bank Accounts")
    expect(g("1100", "asset")).toBe("Cash-in-Hand")
    expect(g("1120", "asset", "razorpay_clearing")).toBe("Current Assets")
    expect(g("1410", "asset", "gst_input_cgst")).toBe("Duties & Taxes")
    expect(g("2210", "liability", "gst_output_cgst")).toBe("Duties & Taxes")
    expect(g("2490", "liability", "suspense")).toBe("Suspense A/c")
    expect(g("3100", "equity")).toBe("Capital Account")
    expect(g("4100", "income")).toBe("Sales Accounts")
    expect(g("4900", "income")).toBe("Indirect Incomes")
    expect(g("5010", "expense")).toBe("Direct Expenses")
    expect(g("5200", "expense")).toBe("Indirect Expenses")
  })

  it("picks voucher types", () => {
    expect(voucherTypeOf("invoice", [])).toBe("Sales")
    expect(voucherTypeOf("credit_note", [])).toBe("Credit Note")
    expect(
      voucherTypeOf("manual", [
        { debitPaise: 5n, cashOrBank: true },
        { debitPaise: -5n, cashOrBank: false },
      ])
    ).toBe("Receipt")
    expect(
      voucherTypeOf("manual", [
        { debitPaise: -5n, cashOrBank: true },
        { debitPaise: 5n, cashOrBank: false },
      ])
    ).toBe("Payment")
    expect(
      voucherTypeOf("manual", [
        { debitPaise: -5n, cashOrBank: true },
        { debitPaise: 5n, cashOrBank: true },
      ])
    ).toBe("Contra")
    expect(
      voucherTypeOf("manual", [
        { debitPaise: -5n, cashOrBank: false },
        { debitPaise: 5n, cashOrBank: false },
      ])
    ).toBe("Journal")
  })

  it("makes ledger names unique", () => {
    expect(uniqueNames(["Rent", "rent", "Acme", "Rent"])).toEqual([
      "Rent",
      "rent (2)",
      "Acme",
      "Rent (3)",
    ])
  })

  it("round-trips through the Tally reader with the same balances", () => {
    const ledgers = [
      {
        name: "HDFC & Co Bank",
        group: "Bank Accounts",
        openingPaise: 50_000_00n,
        gstin: null,
      },
      {
        name: "Share capital",
        group: "Capital Account",
        openingPaise: -50_000_00n,
        gstin: null,
      },
      {
        name: "Acme <Retail>",
        group: "Sundry Debtors",
        openingPaise: 0n,
        gstin: "29AAPFU0939F1ZV",
      },
      {
        name: "Subscription revenue",
        group: "Sales Accounts",
        openingPaise: 0n,
        gstin: null,
      },
    ]
    const vouchers = [
      {
        guid: "median-1",
        date: "2026-11-05",
        type: "Sales" as const,
        number: "MED-1",
        narration: "Invoice INV/2026-27/0001",
        lines: [
          { ledger: "Subscription revenue", debitPaise: -1_000_00n },
          { ledger: "Acme <Retail>", debitPaise: 1_000_00n },
        ],
      },
    ]
    const masters = readTally(mastersXml(ledgers))
    const vchs = readTally(vouchersXml(vouchers))
    expect(masters.errors).toEqual([])
    expect(
      masters.ledgers.map((l) => [l.name, l.nature, l.openingPaise])
    ).toEqual([
      ["HDFC & Co Bank", "bank", 50_000_00n],
      ["Share capital", "capital", -50_000_00n],
      ["Acme <Retail>", "debtor", 0n],
      ["Subscription revenue", "sales", 0n],
    ])
    expect(masters.ledgers[2]?.gstin).toBe("29AAPFU0939F1ZV")
    expect(vchs.vouchers).toEqual([
      {
        guid: "median-1",
        date: "2026-11-05",
        type: "Sales",
        number: "MED-1",
        narration: "Invoice INV/2026-27/0001",
        lines: [
          { ledger: "Acme <Retail>", amountPaise: 1_000_00n },
          { ledger: "Subscription revenue", amountPaise: -1_000_00n },
        ],
      },
    ])
    const closing = closingBalances(masters.ledgers, vchs.vouchers)
    expect(closing.get("Acme <Retail>")).toBe(1_000_00n)
    expect([...closing.values()].reduce((s, v) => s + v, 0n)).toBe(0n)
  })
})
