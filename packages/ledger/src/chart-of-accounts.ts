import type { AccountType } from "./types"

/**
 * Chart-of-accounts templates for Indian startups, seeded when an
 * organisation is created.
 *
 * Codes are four digits and the ranges map onto Schedule III groupings, so
 * reports can group user-created accounts by code too:
 *
 *   1100–1199 cash and bank              current assets
 *   1200–1299 trade receivables          current assets
 *   1300–1399 advances, deposits         current assets
 *   1400–1499 GST input, TDS receivable  current assets
 *   1500–1599 inventories                current assets
 *   1600–1799 property, plant, intangibles  non-current assets
 *   2100–2199 trade payables             current liabilities
 *   2200–2299 duties and taxes           current liabilities
 *   2300–2499 other current liabilities, provisions
 *   2500–2599 long-term borrowings       non-current liabilities
 *   3000–3999 equity                     shareholders' funds
 *   4000–4499 revenue from operations
 *   4500–4999 other income
 *   5000–5099 cost of goods / services
 *   5100–5199 employee benefits
 *   5200–5799 other expenses
 *   5800–5899 finance costs
 *   5900–5999 depreciation and amortisation
 */

export type Industry = "saas" | "d2c" | "agency"

export const INDUSTRIES: readonly Industry[] = ["saas", "d2c", "agency"]

/**
 * Accounts the deterministic rules post to. Every template has exactly one
 * account per key.
 */
export type SystemAccountKey =
  | "bank_default"
  | "razorpay_clearing"
  | "trade_receivables"
  | "vendor_advances"
  | "tds_receivable"
  | "gst_input_cgst"
  | "gst_input_sgst"
  | "gst_input_igst"
  | "trade_payables"
  | "gst_output_cgst"
  | "gst_output_sgst"
  | "gst_output_igst"
  | "tds_payable"
  | "suspense"
  | "opening_balance_equity"
  | "retained_earnings"
  | "revenue_default"
  | "gateway_charges"
  | "bank_charges"
  | "round_off"

export const SYSTEM_ACCOUNT_KEYS: readonly SystemAccountKey[] = [
  "bank_default",
  "razorpay_clearing",
  "trade_receivables",
  "vendor_advances",
  "tds_receivable",
  "gst_input_cgst",
  "gst_input_sgst",
  "gst_input_igst",
  "trade_payables",
  "gst_output_cgst",
  "gst_output_sgst",
  "gst_output_igst",
  "tds_payable",
  "suspense",
  "opening_balance_equity",
  "retained_earnings",
  "revenue_default",
  "gateway_charges",
  "bank_charges",
  "round_off",
]

export interface AccountTemplate {
  readonly code: string
  readonly name: string
  readonly type: AccountType
  readonly systemKey?: SystemAccountKey
  /** A bank account (bank statements connect to it). */
  readonly isBank?: boolean
  /** Code of the parent account in the same template. */
  readonly parentCode?: string
}

const a = (
  code: string,
  name: string,
  type: AccountType,
  extra: Pick<AccountTemplate, "systemKey" | "parentCode" | "isBank"> = {}
): AccountTemplate => ({ code, name, type, ...extra })

/** Accounts every startup needs. */
export const BASE_ACCOUNTS: readonly AccountTemplate[] = [
  // Current assets
  a("1100", "Cash in hand", "asset"),
  a("1110", "Bank current account", "asset", {
    systemKey: "bank_default",
    isBank: true,
  }),
  a("1120", "Razorpay clearing", "asset", { systemKey: "razorpay_clearing" }),
  a("1200", "Trade receivables", "asset", { systemKey: "trade_receivables" }),
  a("1300", "Advances to vendors", "asset", { systemKey: "vendor_advances" }),
  a("1310", "Security deposits", "asset"),
  a("1320", "Prepaid expenses", "asset"),
  a("1400", "GST input credit", "asset"),
  a("1410", "Input CGST", "asset", {
    systemKey: "gst_input_cgst",
    parentCode: "1400",
  }),
  a("1411", "Input SGST", "asset", {
    systemKey: "gst_input_sgst",
    parentCode: "1400",
  }),
  a("1412", "Input IGST", "asset", {
    systemKey: "gst_input_igst",
    parentCode: "1400",
  }),
  a("1450", "TDS receivable", "asset", { systemKey: "tds_receivable" }),
  // Non-current assets
  a("1600", "Computers and equipment", "asset"),
  a("1610", "Furniture and fixtures", "asset"),
  a("1690", "Accumulated depreciation", "asset"),
  // Current liabilities
  a("2100", "Trade payables", "liability", { systemKey: "trade_payables" }),
  a("2200", "GST output tax", "liability"),
  a("2210", "Output CGST", "liability", {
    systemKey: "gst_output_cgst",
    parentCode: "2200",
  }),
  a("2211", "Output SGST", "liability", {
    systemKey: "gst_output_sgst",
    parentCode: "2200",
  }),
  a("2212", "Output IGST", "liability", {
    systemKey: "gst_output_igst",
    parentCode: "2200",
  }),
  a("2250", "TDS payable", "liability", { systemKey: "tds_payable" }),
  a("2260", "Professional tax payable", "liability"),
  a("2270", "PF and ESI payable", "liability"),
  a("2300", "Salaries payable", "liability"),
  a("2310", "Customer advances", "liability"),
  a("2400", "Provision for expenses", "liability"),
  a("2490", "Suspense", "liability", { systemKey: "suspense" }),
  // Non-current liabilities
  a("2500", "Long-term borrowings", "liability"),
  // Equity
  a("3100", "Share capital", "equity"),
  a("3200", "Securities premium", "equity"),
  a("3300", "Retained earnings", "equity", { systemKey: "retained_earnings" }),
  a("3900", "Opening balance equity", "equity", {
    systemKey: "opening_balance_equity",
  }),
  // Income
  a("4900", "Interest income", "income"),
  a("4910", "Other income", "income"),
  // Expenses
  a("5100", "Salaries and wages", "expense"),
  a("5110", "Staff welfare", "expense"),
  a("5120", "Contribution to PF and ESI", "expense"),
  a("5200", "Rent", "expense"),
  a("5220", "Software subscriptions", "expense"),
  a("5230", "Professional fees", "expense"),
  a("5240", "Travel and conveyance", "expense"),
  a("5250", "Office expenses", "expense"),
  a("5260", "Telephone and internet", "expense"),
  a("5270", "Advertising and marketing", "expense"),
  a("5300", "Bank charges", "expense", { systemKey: "bank_charges" }),
  a("5310", "Payment gateway charges", "expense", {
    systemKey: "gateway_charges",
  }),
  a("5400", "Rates and taxes", "expense"),
  a("5790", "Round off", "expense", { systemKey: "round_off" }),
  a("5800", "Interest expense", "expense"),
  a("5900", "Depreciation", "expense"),
]

/** Extra accounts per industry, including that industry's default revenue. */
export const INDUSTRY_ACCOUNTS: Readonly<
  Record<Industry, readonly AccountTemplate[]>
> = {
  saas: [
    a("1330", "Unbilled revenue", "asset"),
    a("1700", "Capitalised software", "asset"),
    a("2320", "Deferred revenue", "liability"),
    a("4100", "Subscription revenue", "income", {
      systemKey: "revenue_default",
    }),
    a("4110", "Implementation and services revenue", "income"),
    a("4120", "Export of services", "income"),
    a("5010", "Cloud hosting", "expense"),
    a("5020", "Third-party APIs", "expense"),
  ],
  d2c: [
    a("1500", "Inventory: finished goods", "asset"),
    a("1510", "Inventory: packaging", "asset"),
    a("1130", "Marketplace receivables", "asset"),
    a("4100", "Product sales", "income", { systemKey: "revenue_default" }),
    a("4110", "Shipping income", "income"),
    a("4190", "Sales returns", "income"),
    a("5000", "Purchases", "expense"),
    a("5030", "Freight inward", "expense"),
    a("5280", "Shipping and logistics", "expense"),
    a("5290", "Marketplace commissions", "expense"),
  ],
  agency: [
    a("1330", "Unbilled revenue", "asset"),
    a("2320", "Advance from clients", "liability"),
    a("4100", "Service fees", "income", { systemKey: "revenue_default" }),
    a("4110", "Retainer income", "income"),
    a("4120", "Export of services", "income"),
    a("4130", "Reimbursable expenses billed", "income"),
    a("5040", "Freelancers and contractors", "expense"),
    a("5050", "Reimbursable client expenses", "expense"),
  ],
}

/** The full template for an industry: base accounts plus industry extras, by code. */
export function chartOfAccountsFor(
  industry: Industry
): readonly AccountTemplate[] {
  return [...BASE_ACCOUNTS, ...INDUSTRY_ACCOUNTS[industry]].sort((x, y) =>
    x.code.localeCompare(y.code)
  )
}

/** The account type a code range belongs to (see the table above). */
export function accountTypeForCode(code: string): AccountType | null {
  if (!/^\d{4}$/.test(code)) return null
  const first = code[0]
  if (first === "1") return "asset"
  if (first === "2") return "liability"
  if (first === "3") return "equity"
  if (first === "4") return "income"
  if (first === "5") return "expense"
  return null
}
