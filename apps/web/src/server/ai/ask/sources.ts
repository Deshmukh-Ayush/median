import type { IsoDate, JournalSourceType, Period } from "@workspace/contracts"

import type { AskSource } from "@/lib/ask-tools"
import { formatDate, formatPeriod } from "@/lib/format-date"
import { journalHref, trialBalanceHref } from "@/lib/report-params"

export type { AskSource } from "@/lib/ask-tools"

/**
 * The pages that show each figure the model can quote. Every tool result
 * carries its sources; the model cites them as markdown links and the UI
 * lists them under the answer. The model is told to use only these hrefs.
 */
const range = (from: IsoDate, to: IsoDate) =>
  `${formatDate(from)} to ${formatDate(to)}`

export const sources = {
  dashboard: (): AskSource => ({ title: "Home", href: "/" }),

  profitAndLoss: (from: IsoDate, to: IsoDate): AskSource => ({
    title: `Profit and loss, ${range(from, to)}`,
    href: `/reports?from=${from}&to=${to}`,
  }),

  balanceSheet: (asOf: IsoDate): AskSource => ({
    title: `Balance sheet as of ${formatDate(asOf)}`,
    href: `/reports?view=balance-sheet&asOf=${asOf}`,
  }),

  trialBalance: (asOf: IsoDate): AskSource => ({
    title: `Trial balance as of ${formatDate(asOf)}`,
    href: trialBalanceHref(asOf),
  }),

  journal: (filters: {
    readonly accountId?: string | undefined
    readonly from?: IsoDate | undefined
    readonly to?: IsoDate | undefined
    readonly sourceType?: JournalSourceType | undefined
    readonly search?: string | undefined
  }): AskSource => ({
    title:
      filters.from && filters.to
        ? `Journal entries, ${range(filters.from, filters.to)}`
        : "Journal entries",
    href: journalHref({
      accountId: filters.accountId,
      from: filters.from,
      to: filters.to,
      source: filters.sourceType,
      q: filters.search,
    }),
  }),

  invoices: (partyId?: string): AskSource => ({
    title: "Invoices",
    href: partyId ? `/invoices?customer=${partyId}` : "/invoices",
  }),

  invoice: (id: string, number: string): AskSource => ({
    title: `Invoice ${number}`,
    href: `/invoices/${id}`,
  }),

  receivablesAgeing: (): AskSource => ({
    title: "Receivables ageing",
    href: "/invoices",
  }),

  gst: (period: Period): AskSource => ({
    title: `GST summary, ${formatPeriod(period)}`,
    href: `/gst?period=${period}`,
  }),

  revenue: (from: IsoDate, to: IsoDate): AskSource => ({
    title: `Revenue, ${range(from, to)}`,
    href: `/revenue?from=${from}&to=${to}`,
  }),

  cash: (): AskSource => ({ title: "Cash position", href: "/cash" }),

  inbox: (): AskSource => ({ title: "AI inbox", href: "/inbox" }),

  parties: (): AskSource => ({
    title: "Customers and vendors",
    href: "/parties",
  }),

  party: (id: string, name: string): AskSource => ({
    title: name,
    href: `/parties/${id}`,
  }),
} as const
