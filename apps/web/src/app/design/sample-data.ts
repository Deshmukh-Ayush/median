import type { Money } from "@workspace/contracts"
import { paise } from "@workspace/ledger"

import type { InboxRowView } from "@/components/inbox/inbox-view"

/** Fake data for the /design review page only. */

export interface SampleInvoice {
  id: string
  number: string
  customer: string
  issued: string
  due: string
  status: "paid" | "due" | "overdue" | "draft"
  amount: Money
}

const rupees = (value: number) => paise(Math.round(value * 100))

export const invoices: readonly SampleInvoice[] = [
  {
    id: "inv_1",
    number: "INV-0142",
    customer: "Kaveri Foods Pvt Ltd",
    issued: "02 Nov",
    due: "02 Dec",
    status: "due",
    amount: rupees(2_36_000),
  },
  {
    id: "inv_2",
    number: "INV-0141",
    customer: "Northstar Analytics",
    issued: "28 Oct",
    due: "27 Nov",
    status: "paid",
    amount: rupees(1_18_000),
  },
  {
    id: "inv_3",
    number: "INV-0140",
    customer: "Bluefin Logistics LLP",
    issued: "12 Sep",
    due: "12 Oct",
    status: "overdue",
    amount: rupees(4_72_500),
  },
  {
    id: "inv_4",
    number: "INV-0139",
    customer: "Tara Studio",
    issued: "05 Sep",
    due: "05 Oct",
    status: "paid",
    amount: rupees(59_000),
  },
  {
    id: "inv_5",
    number: "INV-0138",
    customer: "Meridian Health",
    issued: "30 Aug",
    due: "29 Sep",
    status: "paid",
    amount: rupees(12_34_567),
  },
  {
    id: "inv_6",
    number: "INV-0143",
    customer: "Kaveri Foods Pvt Ltd",
    issued: "—",
    due: "—",
    status: "draft",
    amount: rupees(88_500),
  },
]

export const stats = {
  moneyIn: {
    value: rupees(18_42_350),
    change: rupees(2_14_000),
    percent: 13.1,
  },
  owedToYou: {
    value: rupees(7_97_000),
    change: rupees(-1_20_500),
    percent: -13.1,
  },
  taxDue: { value: rupees(1_63_420), change: rupees(18_900), percent: 13.1 },
  cash: { value: rupees(42_18_905), change: rupees(-3_05_000), percent: -6.7 },
}

export const moneySamples: readonly { label: string; value: Money }[] = [
  { label: "Zero", value: rupees(0) },
  { label: "Hundreds", value: rupees(999) },
  { label: "Thousands", value: rupees(1_000) },
  { label: "One lakh", value: rupees(1_00_000) },
  { label: "Crores", value: rupees(12_34_56_789) },
  { label: "Negative", value: rupees(-45_250) },
  { label: "Paise", value: paise(1_23_456_78n) },
]

/** Sample AI inbox rows (already prepared for display). */
export const inboxRows: readonly InboxRowView[] = [
  {
    id: "00000000-0000-4000-8000-00000000c001",
    kindLabel: "Bill",
    confidence: 0.86,
    reason: "New vendor bill from AWS. Check the expense account.",
    narration: "AWS invoice IN-2026-118734 (October hosting)",
    entryDate: "2 Nov 2026",
    createdAt: "5 Nov, 4:42 pm",
    amount: paise(49_560_00n),
    goesTo: [
      {
        account: "Hosting and cloud",
        amount: paise(42_000_00n),
        description: "EC2 + RDS",
      },
      {
        account: "Input CGST",
        amount: paise(3_780_00n),
        description: "CGST 9%",
      },
      {
        account: "Input SGST",
        amount: paise(3_780_00n),
        description: "SGST 9%",
      },
    ],
    comesFrom: [
      {
        account: "Accounts payable · AWS India",
        amount: paise(49_560_00n),
        description: null,
      },
    ],
    sourceLabel: "Source document",
    sourceUrl: null,
    gst: {
      taxable: paise(42_000_00n),
      cgst: paise(3_780_00n),
      sgst: paise(3_780_00n),
      igst: paise(0n),
      rateLabel: "18%",
      interstate: false,
    },
    tds: null,
    taxEditable: true,
    flags: [
      { field: "vendor.gstin", reason: "Not seen on earlier AWS bills." },
    ],
    refund: null,
  },
  {
    id: "00000000-0000-4000-8000-00000000c002",
    kindLabel: "Bank line",
    confidence: 0.42,
    reason:
      'Bank debit of ₹1,85,000.00 with reference "NEFT-SAL-OCT" didn\'t match any bill or vendor.',
    narration: "NEFT-SAL-OCT",
    entryDate: "1 Nov 2026",
    createdAt: "4 Nov, 11:05 am",
    amount: paise(1_85_000_00n),
    goesTo: [
      { account: "Salaries", amount: paise(1_85_000_00n), description: null },
    ],
    comesFrom: [
      {
        account: "HDFC current account",
        amount: paise(1_85_000_00n),
        description: null,
      },
    ],
    sourceLabel: "Source record",
    sourceUrl: null,
    gst: null,
    tds: null,
    taxEditable: false,
    flags: [],
    refund: null,
  },
  {
    id: "00000000-0000-4000-8000-00000000c003",
    kindLabel: "Razorpay payment",
    confidence: 0.93,
    reason: "Payment matched invoice INV-0042 by amount and customer.",
    narration: "Razorpay pay_PX81 for INV-0042",
    entryDate: "31 Oct 2026",
    createdAt: "3 Nov, 9:30 am",
    amount: paise(1_18_000_00n),
    goesTo: [
      {
        account: "Razorpay clearing",
        amount: paise(1_18_000_00n),
        description: null,
      },
    ],
    comesFrom: [
      {
        account: "Accounts receivable · Acme Labs",
        amount: paise(1_18_000_00n),
        description: null,
      },
    ],
    sourceLabel: "Source record",
    sourceUrl: null,
    gst: null,
    tds: { section: "194J", rate: "2", amount: paise(2_000_00n) },
    taxEditable: true,
    flags: [],
    refund: null,
  },
]
