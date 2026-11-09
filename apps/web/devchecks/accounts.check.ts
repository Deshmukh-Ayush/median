import { expect, it } from "vitest"
import { listLedgerAccounts } from "../src/server/services/accounts"
import { freshDevOrg } from "./setup"

it("listLedgerAccounts on the dev DB", async () => {
  const ctx = await freshDevOrg("accounts")
  const banks = await listLedgerAccounts(ctx, null, { bankOnly: true })
  expect(banks.items.map((a) => [a.code, a.name, a.isBank])).toEqual([
    ["1110", "Bank current account", true],
  ])
  const p1 = await listLedgerAccounts(
    ctx,
    null,
    { type: "asset" },
    { limit: 5 }
  )
  const p2 = await listLedgerAccounts(
    ctx,
    p1.nextCursor,
    { type: "asset" },
    { limit: 5 }
  )
  expect(p1.items).toHaveLength(5)
  expect(p2.items[0]!.code > p1.items[4]!.code).toBe(true)
  expect(
    (await listLedgerAccounts(ctx, null, { search: "gst" })).items.every((a) =>
      /gst/i.test(a.name)
    )
  ).toBe(true)
  expect(
    (await listLedgerAccounts(ctx, null, { search: "14" })).items.map(
      (a) => a.code
    )
  ).toEqual(["1400", "1410", "1411", "1412", "1450"])
  expect((await listLedgerAccounts(ctx, null, { search: "%" })).items).toEqual(
    []
  )
})
