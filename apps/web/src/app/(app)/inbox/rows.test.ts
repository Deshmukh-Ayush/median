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
  proposedEntry: {
    entryDate: "2026-11-02",
    narration: "AWS invoice",
    lines: [
      {
        accountId: ACC.hosting,
        partyId: null,
        debit: paise(42_000_00n),
        credit: paise(0n),
        description: "EC2",
      },
      {
        accountId: ACC.cgst,
        partyId: null,
        debit: paise(3_780_00n),
        credit: paise(0n),
        description: "CGST 9%",
      },
      {
        accountId: ACC.payables,
        partyId: AWS,
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

const accounts = new Map([
  [ACC.hosting, "Hosting"],
  [ACC.cgst, "Input CGST"],
  [ACC.payables, "Accounts payable"],
])
const parties = new Map([[AWS, "AWS India"]])

describe("toInboxRow", () => {
  it("splits lines into where money goes and where it comes from", () => {
    const row = toInboxRow(item, accounts, parties)
    expect(row.goesTo.map((l) => l.account)).toEqual(["Hosting", "Input CGST"])
    expect(row.comesFrom).toEqual([
      {
        account: "Accounts payable · AWS India",
        amount: 45_780_00n,
        description: null,
      },
    ])
    expect(row.amount).toBe(45_780_00n)
  })

  it("labels the item and formats dates", () => {
    const row = toInboxRow(item, accounts, parties)
    expect(row.kindLabel).toBe("Bill")
    expect(row.entryDate).toBe("2 Nov 2026")
    expect(row.sourceLabel).toBe("Source document")
  })

  it("falls back when an account isn't in the lookup", () => {
    const row = toInboxRow(item, new Map(), new Map())
    expect(row.goesTo[0]?.account).toBe("Unknown account")
    expect(row.comesFrom[0]?.account).toBe("Unknown account")
  })
})
