import { and, eq } from "drizzle-orm"
import { expect, it } from "vitest"
import { paise } from "@workspace/ledger"

import { getDb } from "../src/server/db"
import { ledgerAccounts } from "../src/server/db/schema"
import { postManualEntry } from "../src/server/services/ledger"
import {
  getBalanceSheet,
  getCashFlowStatement,
  getProfitAndLoss,
  getTrialBalance,
} from "../src/server/services/reports"
import { freshDevOrg } from "./setup"

it("comparatives and a cash flow that ties to the bank", async () => {
  const ctx = await freshDevOrg("cashflow")
  const accounts = await getDb()
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.organizationId, ctx.orgId)))
  const id = (code: string) => accounts.find((a) => a.code === code)!.id
  const post = (date: string, dr: string, cr: string, rupees: number) =>
    postManualEntry(ctx, {
      entryDate: date,
      narration: `${dr}/${cr}`,
      lines: [
        {
          accountId: id(dr),
          debit: paise(BigInt(rupees * 100)),
          credit: paise(0n),
        },
        {
          accountId: id(cr),
          debit: paise(0n),
          credit: paise(BigInt(rupees * 100)),
        },
      ],
    })

  // FY 2025-26: capital, a sale, rent.
  await post("2025-04-01", "1110", "3100", 500_000)
  await post("2025-06-15", "1110", "4100", 100_000)
  await post("2025-06-30", "5200", "1110", 30_000)
  // FY 2026-27: a bigger sale (half unpaid), a laptop, depreciation, a loan.
  await post("2026-06-15", "1200", "4100", 150_000)
  await post("2026-07-15", "1110", "1200", 75_000)
  await post("2026-07-20", "1600", "1110", 90_000)
  await post("2026-09-30", "5900", "1690", 7_500)
  await post("2026-08-01", "1110", "2500", 200_000)

  const pl = await getProfitAndLoss(ctx, "2026-04-01", "2026-09-30")
  expect(pl.netProfit).toBe(142_500_00n)
  expect(pl.previous).toMatchObject({
    from: "2025-04-01",
    to: "2025-09-30",
    netProfit: 70_000_00n,
  })
  const bs = await getBalanceSheet(ctx, "2026-09-30")
  expect(bs.totalAssets).toBe(bs.totalEquityAndLiabilities)
  expect(bs.previous?.asOf).toBe("2025-09-30")
  expect(bs.previous?.totalAssets).toBe(570_000_00n)

  const cf = await getCashFlowStatement(ctx, "2026-04-01", "2026-09-30")
  expect(cf.difference).toBe(0n)
  // Operating: 1,42,500 + 7,500 − 75,000 more receivables = 75,000.
  expect(cf.operating.total).toBe(75_000_00n)
  expect(cf.investing.total).toBe(-90_000_00n)
  expect(cf.financing.total).toBe(200_000_00n)
  const tb = await getTrialBalance(ctx, "2026-09-30")
  const bank = tb.rows.find((r) => r.code === "1110")
  expect(cf.closingCash).toBe(bank?.debit)
  expect(cf.previous?.difference).toBe(0n)
})
