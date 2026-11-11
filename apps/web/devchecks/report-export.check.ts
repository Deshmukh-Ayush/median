import { and, eq } from "drizzle-orm"
import { expect, it } from "vitest"
import { paise } from "@workspace/ledger"

import { getDb } from "../src/server/db"
import { ledgerAccounts } from "../src/server/db/schema"
import { postManualEntry } from "../src/server/services/ledger"
import { exportReport } from "../src/server/services/report-export"
import { freshDevOrg } from "./setup"

it("exports trial balance, P&L, balance sheet and ageing as .xlsx", async () => {
  const ctx = await freshDevOrg("xlsx")
  const accounts = await getDb()
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.organizationId, ctx.orgId)))
  const id = (code: string) => accounts.find((a) => a.code === code)!.id
  const post = (date: string, dr: string, cr: string, p: bigint) =>
    postManualEntry(ctx, {
      entryDate: date,
      narration: `${dr}/${cr}`,
      lines: [
        { accountId: id(dr), debit: paise(p), credit: paise(0n) },
        { accountId: id(cr), debit: paise(0n), credit: paise(p) },
      ],
    })
  await post("2026-04-01", "1110", "3100", 1_23_45_678_90n)
  await post("2026-05-10", "1110", "4100", 2_50_000_00n)
  await post("2026-06-30", "5200", "1110", 60_000_00n)

  const files = await Promise.all([
    exportReport(ctx, { report: "trial_balance", asOf: "2026-09-30" }),
    exportReport(ctx, {
      report: "profit_and_loss",
      from: "2026-04-01",
      to: "2026-09-30",
    }),
    exportReport(ctx, { report: "balance_sheet", asOf: "2026-09-30" }),
    exportReport(ctx, { report: "receivables_ageing" }),
  ])
  for (const f of files) {
    expect(Buffer.from(f.bytes.subarray(0, 4)).toString("hex")).toBe("504b0304")
  }
  expect(files.map((f) => f.fileName)).toEqual([
    "trial-balance-2026-09-30.xlsx",
    "profit-and-loss-2026-04-01-to-2026-09-30.xlsx",
    "balance-sheet-2026-09-30.xlsx",
    "receivables-ageing.xlsx",
  ])
  await expect(
    exportReport({ ...ctx, role: "investor" }, { report: "receivables_ageing" })
  ).rejects.toMatchObject({ code: "FORBIDDEN" })
})
