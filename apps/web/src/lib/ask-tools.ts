/** Ask Median's tools, labelled for the steps shown under a question. */
export const ASK_TOOL_LABELS = {
  getDashboardSummary: "Read the home summary",
  getProfitAndLoss: "Read profit and loss",
  getBalanceSheet: "Read the balance sheet",
  getTrialBalance: "Read the trial balance",
  listEntries: "Read journal entries",
  listInvoices: "Read invoices",
  getInvoice: "Read an invoice",
  getReceivablesAgeing: "Read receivables ageing",
  getGstSummary: "Read the GST summary",
  getRevenueBreakdown: "Read revenue",
  getCashPosition: "Read the cash position",
  listInboxItems: "Read the AI inbox",
  listParties: "Read customers and vendors",
} as const

export type AskToolName = keyof typeof ASK_TOOL_LABELS

export function isAskToolName(name: string): name is AskToolName {
  return Object.hasOwn(ASK_TOOL_LABELS, name)
}

/** A cited page, as tools return it and the UI lists it. */
export interface AskSource {
  readonly title: string
  readonly href: string
}
