// Realistic fake data for service stubs, so screens can be built before the
// real logic lands. Each stub is replaced by a real query during the week;
// delete this file once nothing imports it.

import { paise } from "@workspace/ledger"

import type {
  IsoDate,
  IsoTimestamp,
  JournalEntryView,
  LedgerAccountSummary,
  PartyRef,
} from "./types"

/** Today minus `n` days, as YYYY-MM-DD. */
export function daysAgo(n: number): IsoDate {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export function timestampDaysAgo(n: number): IsoTimestamp {
  return new Date(Date.now() - n * 86_400_000).toISOString()
}

export function currentPeriod(offsetMonths = 0): string {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + offsetMonths)
  return d.toISOString().slice(0, 7)
}

const account = (
  id: string,
  code: string,
  name: string,
  type: LedgerAccountSummary["type"]
): LedgerAccountSummary => ({
  id,
  code,
  name,
  type,
  parentId: null,
  isSystem: true,
})

export const STUB_ACCOUNTS = {
  bank: account(
    "00000000-0000-4000-8000-000000001001",
    "1110",
    "HDFC Bank current a/c",
    "asset"
  ),
  razorpayClearing: account(
    "00000000-0000-4000-8000-000000001002",
    "1120",
    "Razorpay clearing",
    "asset"
  ),
  receivables: account(
    "00000000-0000-4000-8000-000000001003",
    "1200",
    "Trade receivables",
    "asset"
  ),
  inputCgst: account(
    "00000000-0000-4000-8000-000000001004",
    "1410",
    "Input CGST",
    "asset"
  ),
  inputSgst: account(
    "00000000-0000-4000-8000-000000001005",
    "1411",
    "Input SGST",
    "asset"
  ),
  inputIgst: account(
    "00000000-0000-4000-8000-000000001006",
    "1412",
    "Input IGST",
    "asset"
  ),
  payables: account(
    "00000000-0000-4000-8000-000000002001",
    "2100",
    "Trade payables",
    "liability"
  ),
  outputCgst: account(
    "00000000-0000-4000-8000-000000002002",
    "2210",
    "Output CGST",
    "liability"
  ),
  outputSgst: account(
    "00000000-0000-4000-8000-000000002003",
    "2211",
    "Output SGST",
    "liability"
  ),
  outputIgst: account(
    "00000000-0000-4000-8000-000000002004",
    "2212",
    "Output IGST",
    "liability"
  ),
  capital: account(
    "00000000-0000-4000-8000-000000003001",
    "3100",
    "Share capital",
    "equity"
  ),
  saasRevenue: account(
    "00000000-0000-4000-8000-000000004001",
    "4100",
    "Subscription revenue",
    "income"
  ),
  gatewayCharges: account(
    "00000000-0000-4000-8000-000000005001",
    "5310",
    "Payment gateway charges",
    "expense"
  ),
  hosting: account(
    "00000000-0000-4000-8000-000000005002",
    "5210",
    "Cloud hosting",
    "expense"
  ),
  salaries: account(
    "00000000-0000-4000-8000-000000005003",
    "5100",
    "Salaries",
    "expense"
  ),
} as const

export const STUB_ACCOUNT_LIST: readonly LedgerAccountSummary[] =
  Object.values(STUB_ACCOUNTS)

export const STUB_PARTIES = {
  acme: {
    id: "00000000-0000-4000-8000-000000009001",
    name: "Acme Retail Pvt Ltd",
    gstin: "29AABCA1234F1Z5",
  },
  zenith: {
    id: "00000000-0000-4000-8000-000000009002",
    name: "Zenith Analytics LLP",
    gstin: "27AAFFZ6789K1Z2",
  },
  aws: {
    id: "00000000-0000-4000-8000-000000009003",
    name: "Amazon Web Services India Pvt Ltd",
    gstin: "29AAICA3918J1ZE",
  },
} as const satisfies Record<string, PartyRef>

const lineRef = (a: LedgerAccountSummary) => ({
  id: a.id,
  code: a.code,
  name: a.name,
  type: a.type,
})

export const STUB_ENTRIES: readonly JournalEntryView[] = [
  {
    id: "00000000-0000-4000-8000-00000000e001",
    entryDate: daysAgo(3),
    narration: "Invoice INV/2026-27/0042 to Acme Retail",
    sourceType: "invoice",
    sourceId: "00000000-0000-4000-8000-00000000a001",
    reversesEntryId: null,
    reversedByEntryId: null,
    total: paise(1_18_000_00n),
    createdBy: null,
    createdAt: timestampDaysAgo(3),
    lines: [
      {
        id: "00000000-0000-4000-8000-00000000f001",
        account: lineRef(STUB_ACCOUNTS.receivables),
        party: STUB_PARTIES.acme,
        debit: paise(1_18_000_00n),
        credit: paise(0n),
        description: null,
      },
      {
        id: "00000000-0000-4000-8000-00000000f002",
        account: lineRef(STUB_ACCOUNTS.saasRevenue),
        party: null,
        debit: paise(0n),
        credit: paise(1_00_000_00n),
        description: "Annual plan",
      },
      {
        id: "00000000-0000-4000-8000-00000000f003",
        account: lineRef(STUB_ACCOUNTS.outputCgst),
        party: null,
        debit: paise(0n),
        credit: paise(9_000_00n),
        description: null,
      },
      {
        id: "00000000-0000-4000-8000-00000000f004",
        account: lineRef(STUB_ACCOUNTS.outputSgst),
        party: null,
        debit: paise(0n),
        credit: paise(9_000_00n),
        description: null,
      },
    ],
  },
  {
    id: "00000000-0000-4000-8000-00000000e002",
    entryDate: daysAgo(2),
    narration: "Razorpay payment pay_PqR8sT2uV4 (Zenith Analytics)",
    sourceType: "razorpay",
    sourceId: "00000000-0000-4000-8000-00000000b001",
    reversesEntryId: null,
    reversedByEntryId: null,
    total: paise(29_500_00n),
    createdBy: null,
    createdAt: timestampDaysAgo(2),
    lines: [
      {
        id: "00000000-0000-4000-8000-00000000f005",
        account: lineRef(STUB_ACCOUNTS.razorpayClearing),
        party: null,
        debit: paise(29_500_00n),
        credit: paise(0n),
        description: null,
      },
      {
        id: "00000000-0000-4000-8000-00000000f006",
        account: lineRef(STUB_ACCOUNTS.receivables),
        party: STUB_PARTIES.zenith,
        debit: paise(0n),
        credit: paise(29_500_00n),
        description: null,
      },
    ],
  },
  {
    id: "00000000-0000-4000-8000-00000000e003",
    entryDate: daysAgo(1),
    narration: "Razorpay fee on pay_PqR8sT2uV4",
    sourceType: "razorpay",
    sourceId: "00000000-0000-4000-8000-00000000b002",
    reversesEntryId: null,
    reversedByEntryId: null,
    total: paise(696_20n),
    createdBy: null,
    createdAt: timestampDaysAgo(1),
    lines: [
      {
        id: "00000000-0000-4000-8000-00000000f007",
        account: lineRef(STUB_ACCOUNTS.gatewayCharges),
        party: null,
        debit: paise(590_00n),
        credit: paise(0n),
        description: "2% fee",
      },
      {
        id: "00000000-0000-4000-8000-00000000f008",
        account: lineRef(STUB_ACCOUNTS.inputIgst),
        party: null,
        debit: paise(106_20n),
        credit: paise(0n),
        description: "GST on fee",
      },
      {
        id: "00000000-0000-4000-8000-00000000f009",
        account: lineRef(STUB_ACCOUNTS.razorpayClearing),
        party: null,
        debit: paise(0n),
        credit: paise(696_20n),
        description: null,
      },
    ],
  },
]
