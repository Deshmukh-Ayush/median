import { describe, expect, it } from "vitest"

import { paise } from "@workspace/ledger"

import type { InboxItem } from "@/server/services"

import { toInboxRow } from "./rows"

const ACC = {
  hosting: "00000000-0000-4000-8000-0000000000a1",
  cgst: "00000000-0000-4000-8000-0000000000a2",
  payables: "00000000-0000-4000-8000-0000000000a3",
}
const AWS = "00000000-0000-4000-8000-0000000000f1"

const item: InboxItem = {
  id: "00000000-0000-4000-8000-00000000c001",
  kind: "bill",
  status: "pending",
  confidence: 0.86,
  reason: "New vendor bill from AWS.",
  sourceRef: { type: "document", id: "00000000-0000-4000-8000-00000000d001" },
  sourceDocumentUrl: null,
  gst: null,
  tds: null,
  reviewFlags: { needsReview: [], notPrinted: [] },
  proposedEntry: {
    entryDate: "2026-11-02",
    narration: "AWS invoice",
    lines: [
      {
        accountId: ACC.hosting,
        accountCode: "5100",
        accountName: "Hosting",
        accountType: "expense",
        partyId: null,
        partyName: null,
        debit: paise(42_000_00n),
        credit: paise(0n),
        description: "EC2",
      },
      {
        accountId: ACC.cgst,
        accountCode: "1410",
        accountName: "Input CGST",
        accountType: "asset",
        partyId: null,
        partyName: null,
        debit: paise(3_780_00n),
        credit: paise(0n),
        description: "CGST 9%",
      },
      {
        accountId: ACC.payables,
        accountCode: "2100",
        accountName: "Accounts payable",
        accountType: "liability",
        partyId: AWS,
        partyName: "AWS",
        debit: paise(0n),
        credit: paise(45_780_00n),
        description: null,
      },
    ],
  },
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  postedEntryId: null,
  createdAt: "2026-11-05T10:00:00.000Z",
}

describe("toInboxRow", () => {
  it("splits lines into where money goes and where it comes from", () => {
    const row = toInboxRow(item)
    expect(row.goesTo.map((l) => l.account)).toEqual(["Hosting", "Input CGST"])
    expect(row.comesFrom).toEqual([
      {
        account: "Accounts payable · AWS",
        amount: 45_780_00n,
        description: null,
      },
    ])
    expect(row.amount).toBe(45_780_00n)
  })

  it("labels the item and formats dates", () => {
    const row = toInboxRow(item)
    expect(row.kindLabel).toBe("Bill")
    expect(row.entryDate).toBe("2 Nov 2026")
    expect(row.sourceLabel).toBe("Source document")
    expect(row.sourceUrl).toBeNull()
  })

  it("passes GST, TDS and review flags through as proposed", () => {
    const row = toInboxRow({
      ...item,
      sourceDocumentUrl: "https://files.example.test/bill.pdf",
      gst: {
        taxable: paise(42_000_00n),
        cgst: paise(3_780_00n),
        sgst: paise(3_780_00n),
        igst: paise(0n),
        rateBps: 1800,
        supplyType: "intrastate",
      },
      tds: { section: "194J", rateBps: 150, amount: paise(630_00n) },
      reviewFlags: {
        needsReview: [
          {
            field: "vendor.gstin",
            kind: "needs_review",
            reason: "Checksum failed",
            source: "check",
          },
        ],
        notPrinted: [],
      },
    })
    expect(row.sourceUrl).toBe("https://files.example.test/bill.pdf")
    expect(row.gst).toMatchObject({ rateLabel: "18%", interstate: false })
    expect(row.tds).toEqual({ section: "194J", rate: "1.5", amount: 630_00n })
    expect(row.flags).toEqual([
      { field: "vendor.gstin", reason: "Checksum failed" },
    ])
    expect(row.taxEditable).toBe(true)
  })

  it("only offers tax edits where tax applies", () => {
    expect(toInboxRow({ ...item, kind: "bank_line" }).taxEditable).toBe(false)
  })

  it("links refunds of invoiced sales to a credit note", () => {
    expect(toInboxRow(item).refund).toBeNull()
    const invoiceId = "00000000-0000-4000-8000-0000000001a1"
    const row = toInboxRow({
      ...item,
      kind: "razorpay_record",
      refund: {
        invoiceId,
        invoiceNumber: "INV/2026-27/0001",
        amount: paise(11_800_00n),
      },
    })
    expect(row.refund).toEqual({
      href: `/invoices/${invoiceId}/credit-note?refund=1180000`,
      invoiceNumber: "INV/2026-27/0001",
      amount: paise(11_800_00n),
    })
  })
})
