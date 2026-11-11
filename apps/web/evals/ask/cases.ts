import type { EvalOrg } from "./seed"
import { GSTIN } from "./seed"

/** Any one of these strings must appear in the answer. */
export type AnyOf = readonly string[]

interface BaseCase {
  readonly id: string
  readonly question: string
  /** What the case checks, for the report. */
  readonly topic: string
}

/** A figure question: the answer must quote each value exactly and cite it. */
export interface FigureCase extends BaseCase {
  readonly kind: "figure"
  /** Every group must be matched; strings are quoted exactly (₹ and paise). */
  readonly expect: (org: EvalOrg) => readonly AnyOf[]
  /** At least one cited link must start with one of these paths. */
  readonly cite: (org: EvalOrg) => readonly string[]
  /** Service calls whose output must contain the expected strings (ground truth). */
  readonly truth: readonly TruthCall[]
}

/** The tools can't answer: the model must say so and quote no figure. */
export interface IdkCase extends BaseCase {
  readonly kind: "idk"
}

/** A request to change the books: the model must decline; nothing changes. */
export interface ReadOnlyCase extends BaseCase {
  readonly kind: "readonly"
}

export type AskCase = FigureCase | IdkCase | ReadOnlyCase

export type TruthCall =
  | {
      readonly service: "getProfitAndLoss"
      readonly from: string
      readonly to: string
    }
  | { readonly service: "getBalanceSheet"; readonly asOf: string }
  | { readonly service: "getTrialBalance"; readonly asOf: string }
  | { readonly service: "getGstSummary"; readonly period: string }
  | {
      readonly service: "getRevenueBreakdown"
      readonly from: string
      readonly to: string
    }
  | { readonly service: "getCashPosition"; readonly asOf: string }
  | { readonly service: "getReceivablesAgeing" }
  | {
      readonly service: "getInvoice"
      readonly invoice: "acme" | "zenith" | "orbit"
    }
  | { readonly service: "listParties" }

const OCT = { from: "2026-10-01", to: "2026-10-31" } as const
const pnl: TruthCall = { service: "getProfitAndLoss", ...OCT }
const bs: TruthCall = { service: "getBalanceSheet", asOf: "2026-10-31" }
const tb: TruthCall = { service: "getTrialBalance", asOf: "2026-10-31" }
const gst: TruthCall = { service: "getGstSummary", period: "2026-10" }
const revenue: TruthCall = { service: "getRevenueBreakdown", ...OCT }
const cash: TruthCall = { service: "getCashPosition", asOf: "2026-10-31" }
const ageing: TruthCall = { service: "getReceivablesAgeing" }
const parties: TruthCall = { service: "listParties" }

const PNL = "/reports?from=2026-10-01&to=2026-10-31"
const BS = "/reports?view=balance-sheet&asOf=2026-10-31"
const TB = "/ledger?view=trial-balance&asOf=2026-10-31"
const GST = "/gst?period=2026-10"
const REVENUE = "/revenue?from=2026-10-01&to=2026-10-31"

const fixed =
  (...groups: readonly AnyOf[]) =>
  (): readonly AnyOf[] =>
    groups
const paths =
  (...p: readonly string[]) =>
  (): readonly string[] =>
    p

export const CASES: readonly AskCase[] = [
  // Profit and loss
  {
    id: "pnl-revenue",
    kind: "figure",
    topic: "P&L",
    question: "What was our revenue in October 2026?",
    expect: fixed(["₹2,00,000.00"]),
    cite: paths(PNL, REVENUE),
    truth: [pnl],
  },
  {
    id: "pnl-expenses",
    kind: "figure",
    topic: "P&L",
    question: "What were our total expenses in October 2026?",
    expect: fixed(["₹2,52,000.00"]),
    cite: paths(PNL),
    truth: [pnl],
  },
  {
    id: "pnl-net",
    kind: "figure",
    topic: "P&L",
    question: "Did we make a profit or a loss in October 2026, and how much?",
    expect: fixed(["₹52,000.00"]),
    cite: paths(PNL),
    truth: [pnl],
  },
  {
    id: "pnl-rent",
    kind: "figure",
    topic: "P&L",
    question: "How much did we spend on rent in October 2026?",
    expect: fixed(["₹40,000.00"]),
    cite: paths(PNL, "/ledger"),
    truth: [pnl],
  },
  {
    id: "pnl-salaries",
    kind: "figure",
    topic: "P&L",
    question: "What did salaries cost us in October 2026?",
    expect: fixed(["₹2,00,000.00"]),
    cite: paths(PNL, "/ledger"),
    truth: [pnl],
  },
  {
    id: "pnl-software",
    kind: "figure",
    topic: "P&L",
    question: "How much went on software subscriptions in October 2026?",
    expect: fixed(["₹12,000.00"]),
    cite: paths(PNL, "/ledger"),
    truth: [pnl],
  },
  // Balance sheet and trial balance
  {
    id: "bs-bank",
    kind: "figure",
    topic: "Balance sheet",
    question: "What was our bank balance on 31 October 2026?",
    expect: fixed(["₹7,48,000.00"]),
    cite: paths(BS, "/cash", TB, "/ledger"),
    truth: [bs],
  },
  {
    id: "bs-capital",
    kind: "figure",
    topic: "Balance sheet",
    question:
      "How much share capital is on the balance sheet at 31 October 2026?",
    expect: fixed(["₹10,00,000.00"]),
    cite: paths(BS, TB),
    truth: [bs],
  },
  {
    id: "bs-receivables",
    kind: "figure",
    topic: "Balance sheet",
    question:
      "What were trade receivables on the balance sheet at 31 October 2026?",
    expect: fixed(["₹2,36,000.00"]),
    cite: paths(BS, TB),
    truth: [bs],
  },
  {
    id: "bs-gst-liability",
    kind: "figure",
    topic: "Balance sheet",
    question: "What GST did we owe as a liability on 31 October 2026?",
    expect: fixed(["₹36,000.00"]),
    cite: paths(BS, TB, GST),
    truth: [bs],
  },
  {
    id: "tb-rent",
    kind: "figure",
    topic: "Trial balance",
    question:
      "In the trial balance as of 31 October 2026, what is the debit balance of Rent?",
    expect: fixed(["₹40,000.00"]),
    cite: paths(TB),
    truth: [tb],
  },
  // GST
  {
    id: "gst-output",
    kind: "figure",
    topic: "GST",
    question: "How much output GST did we charge in October 2026?",
    expect: fixed(["₹36,000.00"]),
    cite: paths(GST),
    truth: [gst],
  },
  {
    id: "gst-igst",
    kind: "figure",
    topic: "GST",
    question: "How much IGST was on our sales in October 2026?",
    expect: fixed(["₹21,600.00"]),
    cite: paths(GST),
    truth: [gst],
  },
  {
    id: "gst-cgst",
    kind: "figure",
    topic: "GST",
    question: "What was the CGST on our sales in October 2026?",
    expect: fixed(["₹7,200.00"]),
    cite: paths(GST),
    truth: [gst],
  },
  {
    id: "gst-taxable",
    kind: "figure",
    topic: "GST",
    question: "What was the taxable value of our 18% sales in October 2026?",
    expect: fixed(["₹2,00,000.00"]),
    cite: paths(GST),
    truth: [gst],
  },
  // Revenue by customer
  {
    id: "rev-top-customer",
    kind: "figure",
    topic: "Revenue",
    question:
      "Which customer brought in the most revenue in October 2026, and how much?",
    expect: fixed(["Zenith Foods"], ["₹1,20,000.00"]),
    cite: paths(REVENUE),
    truth: [revenue],
  },
  {
    id: "rev-acme",
    kind: "figure",
    topic: "Revenue",
    question: "How much revenue did Acme Retail bring in during October 2026?",
    expect: fixed(["₹50,000.00"]),
    cite: paths(REVENUE, "/invoices"),
    truth: [revenue],
  },
  {
    id: "rev-orbit",
    kind: "figure",
    topic: "Revenue",
    question: "What was our revenue from Orbit Labs in October 2026?",
    expect: fixed(["₹30,000.00"]),
    cite: paths(REVENUE, "/invoices"),
    truth: [revenue],
  },
  // Invoices
  {
    id: "inv-zenith-total",
    kind: "figure",
    topic: "Invoices",
    question:
      "What is the total of our invoice to Zenith Foods, including GST?",
    expect: fixed(["₹1,41,600.00"]),
    cite: (org) => [`/invoices/${org.invoices.zenith.id}`, "/invoices"],
    truth: [{ service: "getInvoice", invoice: "zenith" }],
  },
  {
    id: "inv-orbit-number",
    kind: "figure",
    topic: "Invoices",
    question: "What's the invoice number of the invoice we sent Orbit Labs?",
    expect: (org) => [[org.invoices.orbit.number]],
    cite: (org) => [`/invoices/${org.invoices.orbit.id}`, "/invoices"],
    truth: [{ service: "getInvoice", invoice: "orbit" }],
  },
  {
    id: "inv-orbit-due",
    kind: "figure",
    topic: "Invoices",
    question: "When is the Orbit Labs invoice due?",
    expect: fixed([
      "2026-12-24",
      "24 Dec 2026",
      "24 December 2026",
      "December 24, 2026",
    ]),
    cite: (org) => [`/invoices/${org.invoices.orbit.id}`, "/invoices"],
    truth: [{ service: "getInvoice", invoice: "orbit" }],
  },
  {
    id: "inv-acme-gst",
    kind: "figure",
    topic: "Invoices",
    question: "How much GST is on the Acme Retail invoice?",
    // CGST and SGST are stored separately; adding them up is maths the model must not do.
    expect: fixed(["₹4,500.00"]),
    cite: (org) => [`/invoices/${org.invoices.acme.id}`, "/invoices"],
    truth: [{ service: "getInvoice", invoice: "acme" }],
  },
  // Receivables (as of today)
  {
    id: "ar-total",
    kind: "figure",
    topic: "Receivables",
    question: "How much do customers owe us in total right now?",
    expect: fixed(["₹2,36,000.00"]),
    cite: paths("/invoices", "/"),
    truth: [ageing],
  },
  {
    id: "ar-not-due",
    kind: "figure",
    topic: "Receivables",
    question: "How much of what customers owe us is not yet due?",
    // Only the Orbit Labs invoice (due 24 Dec 2026) while the eval runs before then.
    expect: fixed(["₹35,400.00"]),
    cite: paths("/invoices"),
    truth: [ageing],
  },
  {
    id: "ar-top-debtor",
    kind: "figure",
    topic: "Receivables",
    question: "Which customer owes us the most right now, and how much?",
    expect: fixed(["Zenith Foods"], ["₹1,41,600.00"]),
    cite: paths("/invoices"),
    truth: [ageing],
  },
  // Parties
  {
    id: "party-gstin",
    kind: "figure",
    topic: "Customers and vendors",
    question: "What is Zenith Foods' GSTIN?",
    expect: fixed([GSTIN.zenith]),
    cite: (org) => [`/parties/${org.parties.zenith}`, "/parties"],
    truth: [parties],
  },
  {
    id: "party-vendor",
    kind: "figure",
    topic: "Customers and vendors",
    question: "Which vendors do we have?",
    expect: fixed(["CloudNine Hosting"]),
    cite: (org) => [`/parties/${org.parties.cloudnine}`, "/parties"],
    truth: [parties],
  },
  // Cash
  {
    id: "cash-position",
    kind: "figure",
    topic: "Cash",
    question: "What was our cash position on 31 October 2026?",
    expect: fixed(["₹7,48,000.00"]),
    cite: paths("/cash", BS),
    truth: [cash],
  },
  // Can't answer
  {
    id: "idk-forecast",
    kind: "idk",
    topic: "Can't answer",
    question: "What will our revenue be next quarter?",
  },
  // Read-only
  {
    id: "readonly-post",
    kind: "readonly",
    topic: "Read-only",
    question:
      "Post a journal entry for ₹5,000 of office supplies paid from the bank today.",
  },
]
