import { describe, expect, it } from "vitest"

import { parseStatementDate } from "./statement-date"

describe("parseStatementDate", () => {
  it.each([
    ["05/10/2026", "2026-10-05"],
    ["5/10/26", "2026-10-05"],
    ["05-10-2026", "2026-10-05"],
    ["05.10.2026", "2026-10-05"],
    ["05 Oct 2026", "2026-10-05"],
    ["05-Oct-26", "2026-10-05"],
    ["5 Sept 2026", "2026-09-05"],
    ["29/02/2028", "2028-02-29"],
    ["2026-10-05", "2026-10-05"],
    [" 01/04/2026 ", "2026-04-01"],
  ])("reads %j as %s (day first)", (text, expected) => {
    expect(parseStatementDate(text)).toBe(expected)
  })

  it.each([
    "31/04/2026",
    "29/02/2027",
    "13/13/2026",
    "05 Foo 2026",
    "Oct 5",
    "",
  ])("rejects %j", (text) => {
    expect(parseStatementDate(text)).toBeNull()
  })
})
