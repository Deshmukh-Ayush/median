import "server-only"

import { parseInput, reportExportInputSchema } from "@workspace/contracts"
import type {
  BalanceSheet,
  ProfitAndLoss,
  ReportExport,
  ReportExportInput,
  ReportSection,
  TrialBalance,
} from "@workspace/contracts"

import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { getReceivablesAgeing } from "./invoices"
import { getBalanceSheet, getProfitAndLoss, getTrialBalance } from "./reports"
import { writeXlsx } from "./xlsx"
import type { XlsxCell, XlsxSheet } from "./xlsx"

/** Ageing is paged; an export takes every page, up to this many parties. */
const MAX_EXPORT_ROWS = 20_000

function sectionRows(sections: readonly ReportSection[]): XlsxCell[][] {
  return sections.flatMap((s) => [
    [{ bold: s.label }, null, null],
    ...s.rows.map((r): XlsxCell[] => [
      r.code ? `${r.code} ${r.name}` : r.name,
      r.lineItemLabel,
      { money: r.amount },
    ]),
    [{ bold: `Total ${s.label.toLowerCase()}` }, null, { boldMoney: s.total }],
    [],
  ])
}

function trialBalanceSheet(tb: TrialBalance): XlsxSheet {
  return {
    name: `Trial balance ${tb.asOf}`,
    widths: [10, 40, 18, 18],
    rows: [
      [{ bold: `Trial balance as of` }, { date: tb.asOf }],
      [],
      [
        { bold: "Code" },
        { bold: "Account" },
        { bold: "Debit" },
        { bold: "Credit" },
      ],
      ...tb.rows.map((r): XlsxCell[] => [
        r.code,
        r.name,
        { money: r.debit },
        { money: r.credit },
      ]),
      [
        { bold: "Total" },
        null,
        { boldMoney: tb.totalDebit },
        { boldMoney: tb.totalCredit },
      ],
    ],
  }
}

function profitAndLossSheet(pl: ProfitAndLoss): XlsxSheet {
  return {
    name: "Profit and loss",
    widths: [40, 34, 18],
    rows: [
      [{ bold: "Profit and loss" }, { date: pl.from }, { date: pl.to }],
      [],
      [
        { bold: "Account" },
        { bold: "Schedule III line item" },
        { bold: "Amount" },
      ],
      ...sectionRows(pl.income),
      [{ bold: "Total income" }, null, { boldMoney: pl.totalIncome }],
      [],
      ...sectionRows(pl.expenses),
      [{ bold: "Total expenses" }, null, { boldMoney: pl.totalExpenses }],
      [],
      [
        { bold: pl.netProfit < 0n ? "Net loss" : "Net profit" },
        null,
        { boldMoney: pl.netProfit },
      ],
    ],
  }
}

function balanceSheetSheet(bs: BalanceSheet): XlsxSheet {
  return {
    name: `Balance sheet ${bs.asOf}`,
    widths: [40, 34, 18],
    rows: [
      [{ bold: "Balance sheet as of" }, { date: bs.asOf }],
      [],
      [
        { bold: "Account" },
        { bold: "Schedule III line item" },
        { bold: "Amount" },
      ],
      [{ bold: "EQUITY AND LIABILITIES" }],
      ...sectionRows(bs.equityAndLiabilities),
      [
        { bold: "Total equity and liabilities" },
        null,
        { boldMoney: bs.totalEquityAndLiabilities },
      ],
      [],
      [{ bold: "ASSETS" }],
      ...sectionRows(bs.assets),
      [{ bold: "Total assets" }, null, { boldMoney: bs.totalAssets }],
    ],
  }
}

async function receivablesAgeingSheet(ctx: OrgContext): Promise<XlsxSheet> {
  const header: XlsxCell[] = [
    { bold: "Customer" },
    { bold: "GSTIN" },
    { bold: "Open invoices" },
    { bold: "Not due" },
    { bold: "1–30 days" },
    { bold: "31–60 days" },
    { bold: "61–90 days" },
    { bold: "Over 90 days" },
    { bold: "Total" },
  ]
  const first = await getReceivablesAgeing(ctx, null, { limit: 200 })
  const rows: XlsxCell[][] = []
  for (let page = first; ;) {
    for (const p of page.parties.items)
      rows.push([
        p.party.name,
        p.party.gstin ?? "",
        String(p.openInvoices),
        { money: p.notDue },
        { money: p.days1To30 },
        { money: p.days31To60 },
        { money: p.days61To90 },
        { money: p.over90 },
        { money: p.total },
      ])
    const next = page.parties.nextCursor
    if (!next || rows.length >= MAX_EXPORT_ROWS) break
    page = await getReceivablesAgeing(ctx, next, { limit: 200 })
  }
  const { asOf, totals } = first
  return {
    name: "Receivables ageing",
    widths: [36, 18, 14, 16, 16, 16, 16, 16, 18],
    rows: [
      [{ bold: "Receivables ageing as of" }, { date: asOf }],
      [],
      header,
      ...rows,
      [
        { bold: "Total" },
        null,
        null,
        { boldMoney: totals.notDue },
        { boldMoney: totals.days1To30 },
        { boldMoney: totals.days31To60 },
        { boldMoney: totals.days61To90 },
        { boldMoney: totals.over90 },
        { boldMoney: totals.total },
      ],
    ],
  }
}

/**
 * A report as an Excel workbook, built from the same services the screens
 * use, so the numbers match. Owners, finance and CAs only.
 */
export async function exportReport(
  ctx: OrgContext,
  input: ReportExportInput
): Promise<ReportExport> {
  assertCan(ctx, "report", "export")
  const i = parseInput(reportExportInputSchema, input)
  switch (i.report) {
    case "trial_balance":
      return {
        fileName: `trial-balance-${i.asOf}.xlsx`,
        bytes: writeXlsx([
          trialBalanceSheet(await getTrialBalance(ctx, i.asOf)),
        ]),
      }
    case "profit_and_loss":
      return {
        fileName: `profit-and-loss-${i.from}-to-${i.to}.xlsx`,
        bytes: writeXlsx([
          profitAndLossSheet(await getProfitAndLoss(ctx, i.from, i.to)),
        ]),
      }
    case "balance_sheet":
      return {
        fileName: `balance-sheet-${i.asOf}.xlsx`,
        bytes: writeXlsx([
          balanceSheetSheet(await getBalanceSheet(ctx, i.asOf)),
        ]),
      }
    case "receivables_ageing":
      return {
        fileName: "receivables-ageing.xlsx",
        bytes: writeXlsx([await receivablesAgeingSheet(ctx)]),
      }
  }
}
