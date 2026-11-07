import { describe, expect, it } from "vitest"

import { amountInWords, rupeesInWords } from "./amount-in-words"

describe("rupeesInWords", () => {
  it.each([
    [0n, "Zero"],
    [7n, "Seven"],
    [19n, "Nineteen"],
    [40n, "Forty"],
    [99n, "Ninety Nine"],
    [100n, "One Hundred"],
    [305n, "Three Hundred Five"],
    [1_000n, "One Thousand"],
    [18_000n, "Eighteen Thousand"],
    [1_00_000n, "One Lakh"],
    [1_18_000n, "One Lakh Eighteen Thousand"],
    [12_34_567n, "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven"],
    [1_00_00_000n, "One Crore"],
    [
      1_23_45_678n,
      "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight",
    ],
    [120_00_00_000n, "One Hundred Twenty Crore"],
  ])("%d → %s", (n, words) => {
    expect(rupeesInWords(n)).toBe(words)
  })

  it("rejects negatives", () => {
    expect(() => rupeesInWords(-1n)).toThrow(RangeError)
  })
})

describe("amountInWords", () => {
  it("adds paise when there are any", () => {
    expect(amountInWords(1_18_000_50n)).toBe(
      "Rupees One Lakh Eighteen Thousand and Fifty Paise Only"
    )
  })

  it("omits zero paise", () => {
    expect(amountInWords(1_18_000_00n)).toBe(
      "Rupees One Lakh Eighteen Thousand Only"
    )
  })

  it("handles amounts under a rupee", () => {
    expect(amountInWords(5n)).toBe("Rupees Zero and Five Paise Only")
  })
})
