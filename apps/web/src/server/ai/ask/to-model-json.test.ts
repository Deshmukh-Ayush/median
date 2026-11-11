import { paise } from "@workspace/ledger"
import { describe, expect, it } from "vitest"

import { toModelJson } from "./to-model-json"

describe("toModelJson", () => {
  it("formats every bigint as rupees, Indian grouping, exact paise", () => {
    expect(
      toModelJson({
        total: paise(12_345_678_90n),
        refund: paise(-50n),
        nested: [{ amount: paise(0n) }],
      })
    ).toEqual({
      total: "₹1,23,45,678.90",
      refund: "-₹0.50",
      nested: [{ amount: "₹0.00" }],
    })
  })

  it("keeps plain JSON, turns dates into ISO text and drops undefined", () => {
    expect(
      toModelJson({
        name: "Acme",
        count: 3,
        rateBps: 1800,
        paid: false,
        note: null,
        missing: undefined,
        at: new Date("2026-11-12T05:30:00.000Z"),
        nan: Number.NaN,
      })
    ).toEqual({
      name: "Acme",
      count: 3,
      rateBps: 1800,
      paid: false,
      note: null,
      at: "2026-11-12T05:30:00.000Z",
      nan: null,
    })
  })
})
