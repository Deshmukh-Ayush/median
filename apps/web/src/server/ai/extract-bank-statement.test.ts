import { bankRowSchema } from "@workspace/contracts"
import { describe, expect, it, vi } from "vitest"

vi.mock("./models", () => ({ fastModel: {} }))

const { toBankRow } = await import("./extract-bank-statement")

describe("toBankRow", () => {
  it("normalises a printed row into a valid BankRow", () => {
    const row = toBankRow({
      date: "05/10/2026",
      description: "  NEFT-RAZORPAY SOFTWARE-SETTLEMENT  ",
      reference: "UTR123456789",
      debit: null,
      credit: "1,00,000.00",
      balance: "4,25,000.50",
    })
    expect(row).toEqual({
      date: "2026-10-05",
      description: "NEFT-RAZORPAY SOFTWARE-SETTLEMENT",
      reference: "UTR123456789",
      debit: null,
      credit: "1,00,000.00",
      balance: "4,25,000.50",
    })
    expect(bankRowSchema.safeParse(row).success).toBe(true)
  })

  it("turns blank printed values into null", () => {
    const row = toBankRow({
      date: "05 Oct 2026",
      description: "ATM WDL",
      reference: " ",
      debit: "2,000.00",
      credit: "",
      balance: null,
    })
    expect(row.reference).toBeNull()
    expect(row.credit).toBeNull()
    expect(bankRowSchema.safeParse(row).success).toBe(true)
  })

  it("passes an unreadable date through so the importer reports the row", () => {
    const row = toBankRow({
      date: "31/04/2026",
      description: "CHQ DEP",
      reference: null,
      debit: null,
      credit: "500.00",
      balance: null,
    })
    expect(row.date).toBe("31/04/2026")
    expect(bankRowSchema.safeParse(row).success).toBe(false)
  })
})
