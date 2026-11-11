import { and, eq } from "drizzle-orm"
import { expect, it } from "vitest"
import { paise } from "@workspace/ledger"

import { getDb } from "../src/server/db"
import { ledgerAccounts } from "../src/server/db/schema"
import { postManualEntry } from "../src/server/services/ledger"
import { createParty } from "../src/server/services/parties"
import {
  getDayBook,
  getLedger,
  getTrialBalance,
} from "../src/server/services/reports"
import { freshDevOrg } from "./setup"

it("day book oldest first with totals; account and party ledgers", async () => {
  const ctx = await freshDevOrg("daybook")
  const accounts = await getDb()
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.organizationId, ctx.orgId)))
  const id = (code: string) => accounts.find((a) => a.code === code)!.id
  const acme = await createParty(ctx, {
    kind: "customer",
    name: "Acme",
    stateCode: "27",
  })
  const post = (
    date: string,
    dr: string,
    cr: string,
    rupees: number,
    partyId: string | null = null
  ) =>
    postManualEntry(ctx, {
      entryDate: date,
      narration: `${date} ${dr}/${cr}`,
      lines: [
        {
          accountId: id(dr),
          partyId: dr === "1200" ? partyId : null,
          debit: paise(BigInt(rupees * 100)),
          credit: paise(0n),
        },
        {
          accountId: id(cr),
          partyId: cr === "1200" ? partyId : null,
          debit: paise(0n),
          credit: paise(BigInt(rupees * 100)),
        },
      ],
    })
  await post("2026-03-31", "1110", "3100", 100_000) // before the range
  await post("2026-04-05", "1200", "4100", 50_000, acme.id)
  await post("2026-04-02", "5200", "1110", 20_000)
  await post("2026-04-20", "1110", "1200", 30_000, acme.id)

  const book = await getDayBook(ctx, { from: "2026-04-01", to: "2026-04-30" })
  expect(book.entries.items.map((e) => e.entryDate)).toEqual([
    "2026-04-02",
    "2026-04-05",
    "2026-04-20",
  ])
  expect(book.totalDebit).toBe(100_000_00n)
  expect(book.totalCredit).toBe(100_000_00n)
  const page1 = await getDayBook(
    ctx,
    { from: "2026-04-01", to: "2026-04-30" },
    null,
    { limit: 2 }
  )
  const page2 = await getDayBook(
    ctx,
    { from: "2026-04-01", to: "2026-04-30" },
    page1.entries.nextCursor,
    { limit: 2 }
  )
  expect(page2.entries.items.map((e) => e.entryDate)).toEqual(["2026-04-20"])

  // Bank: opening 1,00,000; −20,000; +30,000 → 1,10,000, as the TB says.
  const bank = await getLedger(
    ctx,
    { accountId: id("1110") },
    { from: "2026-04-01", to: "2026-04-30" }
  )
  expect(bank.opening).toBe(100_000_00n)
  expect(bank.lines.map((l) => l.balance)).toEqual([80_000_00n, 110_000_00n])
  const tb = await getTrialBalance(ctx, "2026-04-30")
  expect(bank.closing).toBe(tb.rows.find((r) => r.code === "1110")?.debit)

  // Party ledger: Acme owes 50,000, pays 30,000 → 20,000; paged continuously.
  const acmeLedger = await getLedger(
    ctx,
    { partyId: acme.id },
    { from: "2026-04-01", to: "2026-04-30" }
  )
  expect(acmeLedger.closing).toBe(20_000_00n)
  expect(acmeLedger.lines[0]?.party?.name).toBe("Acme")
  const p1 = await getLedger(
    ctx,
    { partyId: acme.id },
    { from: "2026-04-01", to: "2026-04-30" },
    null,
    { limit: 1 }
  )
  const p2 = await getLedger(
    ctx,
    { partyId: acme.id },
    { from: "2026-04-01", to: "2026-04-30" },
    p1.nextCursor,
    { limit: 1 }
  )
  expect(p2.opening).toBe(p1.closing)
  expect(p2.closing).toBe(20_000_00n)
  await expect(
    getLedger(ctx, {}, { from: "2026-04-01", to: "2026-04-30" })
  ).rejects.toMatchObject({ code: "VALIDATION" })
})
