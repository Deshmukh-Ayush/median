import { ServiceError } from "@workspace/contracts"
import { paise } from "@workspace/ledger"
import { describe, expect, it } from "vitest"

import {
  askProposalSchema,
  checkJournalLines,
  toCreateInvoiceInput,
} from "./ask-proposal-schema"
import { buildInvoice, gstSplitOf } from "./invoice-build"

const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    return error instanceof ServiceError ? error.code : "other"
  }
  return null
}

describe("checkJournalLines (Ask Median journal proposals)", () => {
  it("accepts a balanced entry and returns the totals", () => {
    expect(
      checkJournalLines([
        { accountName: "Rent", debitPaise: 40_000_00n },
        { accountName: "HDFC Bank", creditPaise: 40_000_00n },
      ])
    ).toEqual({ debit: 40_000_00n, credit: 40_000_00n })
  })

  it("rejects debits that don't equal credits", () => {
    expect(
      code(() =>
        checkJournalLines([
          { accountName: "Rent", debitPaise: 40_000_00n },
          { accountName: "HDFC Bank", creditPaise: 39_999_99n },
        ])
      )
    ).toBe("UNBALANCED")
  })

  it("rejects fewer than two lines", () => {
    expect(
      code(() => checkJournalLines([{ accountName: "Rent", debitPaise: 1n }]))
    ).toBe("VALIDATION")
  })

  it("rejects a line with both sides, or neither", () => {
    expect(
      code(() =>
        checkJournalLines([
          { accountName: "Rent", debitPaise: 5n, creditPaise: 5n },
          { accountName: "Bank" },
        ])
      )
    ).toBe("VALIDATION")
  })
})

describe("invoice proposal GST preview (pure GST code, no model maths)", () => {
  const org = { stateCode: "29", gstRegistered: true, compositionScheme: false }
  const line = {
    description: "Consulting, October",
    hsnSac: "998311",
    quantity: "1",
    unitPrice: paise(1_00_000_00n),
    gstRateBps: 1800,
  }

  it("same state: CGST + SGST at 9% each", () => {
    const built = buildInvoice({ reverseCharge: false, lines: [line] }, org, {
      stateCode: "29",
      gstin: "29AAICA3918J1ZE",
    })
    expect(gstSplitOf(built)).toEqual({
      taxable: 1_00_000_00n,
      cgst: 9_000_00n,
      sgst: 9_000_00n,
      igst: 0n,
      rateBps: 1800,
      supplyType: "intrastate",
    })
    expect(built.totals.total).toBe(1_18_000_00n)
  })

  it("other state: IGST at 18%", () => {
    const built = buildInvoice({ reverseCharge: false, lines: [line] }, org, {
      stateCode: "27",
      gstin: "27AAICA3918J1ZE",
    })
    expect(gstSplitOf(built)).toMatchObject({
      cgst: 0n,
      sgst: 0n,
      igst: 18_000_00n,
      supplyType: "interstate",
    })
  })

  it("stored proposal round-trips to createInvoice input", () => {
    const stored = askProposalSchema.parse({
      type: "invoice",
      customerName: "Acme",
      input: {
        partyId: "0b3c1f7e-9c1a-4d0b-8a52-1f0e3b7d9a10",
        invoiceDate: "2026-11-12",
        dueDate: "2026-12-12",
        lines: [{ ...line, unitPrice: "10000000" }],
      },
    })
    if (stored.type !== "invoice") throw new Error("wrong type")
    expect(toCreateInvoiceInput(stored).lines[0]?.unitPrice).toBe(1_00_000_00n)
  })
})
