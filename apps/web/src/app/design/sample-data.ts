import { paise } from "@workspace/ledger"
import type { Money } from "@workspace/ledger"

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
  { label: "With paise", value: paise(1_23_45_678_90n) },
]
