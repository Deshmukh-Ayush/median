import type { AccountType } from "@workspace/contracts"
import { classifyAccount } from "@workspace/ledger"

import { escapeXml } from "../integrations/tally-import/xml"

// Tally-importable XML from Median's books. Pure; services/tally.ts loads
// the data. Tally signs amounts the other way round (debit negative) and
// needs ledger names unique, so both are handled here.

export interface ExportAccount {
  readonly code: string
  readonly name: string
  readonly type: AccountType
  readonly systemKey: string | null
  readonly isBank: boolean
}

/** The Tally primary group an account belongs under. */
export function tallyGroupOf(a: ExportAccount): string {
  const key = a.systemKey ?? ""
  if (key.startsWith("gst_") || key === "tds_payable") return "Duties & Taxes"
  if (key === "suspense") return "Suspense A/c"
  if (key === "trade_receivables") return "Sundry Debtors"
  if (key === "trade_payables") return "Sundry Creditors"
  if (a.isBank) return "Bank Accounts"
  const { lineItem } = classifyAccount(a.code, a.type)
  switch (lineItem) {
    case "cash_and_cash_equivalents":
      return /^110\d$/.test(a.code) ? "Cash-in-Hand" : "Current Assets"
    case "trade_receivables":
      return "Sundry Debtors"
    case "short_term_loans_and_advances":
      return "Loans & Advances (Asset)"
    case "inventories":
      return "Stock-in-Hand"
    case "property_plant_and_equipment":
    case "intangible_assets":
      return "Fixed Assets"
    case "other_non_current_assets":
      return "Investments"
    case "trade_payables":
      return "Sundry Creditors"
    case "other_current_liabilities":
      return /^22\d\d$/.test(a.code) ? "Duties & Taxes" : "Current Liabilities"
    case "short_term_provisions":
      return "Provisions"
    case "long_term_borrowings":
    case "other_long_term_liabilities":
      return "Loans (Liability)"
    case "share_capital":
      return "Capital Account"
    case "reserves_and_surplus":
      return "Reserves & Surplus"
    case "revenue_from_operations":
      return "Sales Accounts"
    case "other_income":
      return "Indirect Incomes"
    case "cost_of_materials_and_services":
      return "Direct Expenses"
    default:
      return a.type === "asset"
        ? "Current Assets"
        : a.type === "liability"
          ? "Current Liabilities"
          : "Indirect Expenses"
  }
}

export interface ExportLedger {
  readonly name: string
  readonly group: string
  /** Debit positive. */
  readonly openingPaise: bigint
  readonly gstin: string | null
}

export interface ExportVoucher {
  readonly guid: string
  /** YYYY-MM-DD */
  readonly date: string
  readonly type:
    "Sales" | "Credit Note" | "Receipt" | "Payment" | "Contra" | "Journal"
  readonly number: string
  readonly narration: string
  /** Debit positive; ledger names as in `ledgers`. */
  readonly lines: readonly {
    readonly ledger: string
    readonly debitPaise: bigint
  }[]
}

/** Tally amount text: rupees, debit negative. */
export function tallyAmount(debitPaise: bigint): string {
  const v = -debitPaise
  const neg = v < 0n
  const abs = neg ? -v : v
  return `${neg ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`
}

/**
 * Picks the voucher type Tally expects: documents keep theirs; otherwise
 * by the cash and bank ledgers involved.
 */
export function voucherTypeOf(
  sourceType: string,
  lines: readonly {
    readonly debitPaise: bigint
    readonly cashOrBank: boolean
  }[]
): ExportVoucher["type"] {
  if (sourceType === "invoice") return "Sales"
  if (sourceType === "credit_note") return "Credit Note"
  const cash = lines.filter((l) => l.cashOrBank)
  if (cash.length === 0) return "Journal"
  if (cash.length === lines.length) return "Contra"
  const net = cash.reduce((s, l) => s + l.debitPaise, 0n)
  return net >= 0n ? "Receipt" : "Payment"
}

const ymd = (iso: string) => iso.replaceAll("-", "")

function envelope(
  report: "All Masters" | "Vouchers",
  messages: readonly string[]
) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC><REPORTNAME>${report}</REPORTNAME></REQUESTDESC>
   <REQUESTDATA>
${messages.map((m) => `    <TALLYMESSAGE xmlns:UDF="TallyUDF">${m}</TALLYMESSAGE>`).join("\n")}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`
}

export function mastersXml(ledgers: readonly ExportLedger[]): string {
  return envelope(
    "All Masters",
    ledgers.map((l) => {
      const n = escapeXml(l.name)
      return `<LEDGER NAME="${n}" ACTION="Create"><NAME.LIST><NAME>${n}</NAME></NAME.LIST><PARENT>${escapeXml(l.group)}</PARENT>${
        l.gstin ? `<PARTYGSTIN>${l.gstin}</PARTYGSTIN>` : ""
      }<OPENINGBALANCE>${tallyAmount(l.openingPaise)}</OPENINGBALANCE></LEDGER>`
    })
  )
}

export function vouchersXml(vouchers: readonly ExportVoucher[]): string {
  return envelope(
    "Vouchers",
    vouchers.map((v) => {
      const lines = [...v.lines]
        .sort((a, b) =>
          b.debitPaise > a.debitPaise ? 1 : b.debitPaise < a.debitPaise ? -1 : 0
        )
        .map(
          (l) =>
            `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${escapeXml(l.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${
              l.debitPaise > 0n ? "Yes" : "No"
            }</ISDEEMEDPOSITIVE><AMOUNT>${tallyAmount(l.debitPaise)}</AMOUNT></ALLLEDGERENTRIES.LIST>`
        )
        .join("")
      return `<VOUCHER VCHTYPE="${v.type}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${ymd(v.date)}</DATE><GUID>${escapeXml(v.guid)}</GUID><VOUCHERTYPENAME>${v.type}</VOUCHERTYPENAME><VOUCHERNUMBER>${escapeXml(v.number)}</VOUCHERNUMBER><NARRATION>${escapeXml(v.narration)}</NARRATION><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>${lines}</VOUCHER>`
    })
  )
}

/** Makes names unique the way Tally needs, keeping the first as is. */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((raw) => {
    const name = raw.trim() || "Unnamed"
    const k = name.toLowerCase()
    const n = (seen.get(k) ?? 0) + 1
    seen.set(k, n)
    return n === 1 ? name : `${name} (${n})`
  })
}
