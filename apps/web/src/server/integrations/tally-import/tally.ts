import { childText, childrenNamed, descendants, parseXml } from "./xml"
import type { XmlElement } from "./xml"

// Tally XML (masters and vouchers) as plain data. Tally signs amounts the
// other way round: negative is debit. Here every amount is in paise with
// debit positive.

/** Tally's predefined primary groups, and what each holds. */
export const PRIMARY_GROUPS = {
  "Bank Accounts": "bank",
  "Bank OD A/c": "loan",
  "Branch / Divisions": "other_long_term_liability",
  "Capital Account": "capital",
  "Cash-in-Hand": "cash",
  "Current Assets": "current_asset",
  "Current Liabilities": "current_liability",
  "Deposits (Asset)": "loan_advance",
  "Direct Expenses": "direct_expense",
  "Direct Incomes": "sales",
  "Duties & Taxes": "duty_tax",
  "Fixed Assets": "fixed_asset",
  "Indirect Expenses": "indirect_expense",
  "Indirect Incomes": "other_income",
  Investments: "investment",
  "Loans & Advances (Asset)": "loan_advance",
  "Loans (Liability)": "loan",
  "Misc. Expenses (ASSET)": "investment",
  Provisions: "provision",
  "Purchase Accounts": "direct_expense",
  "Reserves & Surplus": "reserve",
  "Sales Accounts": "sales",
  "Secured Loans": "loan",
  "Stock-in-Hand": "stock",
  "Sundry Creditors": "creditor",
  "Sundry Debtors": "debtor",
  "Suspense A/c": "suspense",
  "Unsecured Loans": "loan",
} as const

export type TallyNature = (typeof PRIMARY_GROUPS)[keyof typeof PRIMARY_GROUPS]

export interface TallyLedger {
  readonly name: string
  /** Immediate parent group as written in Tally. */
  readonly parent: string
  /** What the ledger's primary group holds; null if its group is unknown. */
  readonly nature: TallyNature | "profit_and_loss" | null
  /** Opening balance, debit positive. */
  readonly openingPaise: bigint
  readonly gstin: string | null
}

export interface TallyVoucherLine {
  readonly ledger: string
  /** Debit positive, credit negative. */
  readonly amountPaise: bigint
}

export interface TallyVoucher {
  readonly guid: string | null
  /** YYYY-MM-DD */
  readonly date: string
  readonly type: string
  readonly number: string
  readonly narration: string
  readonly lines: readonly TallyVoucherLine[]
}

export interface TallyData {
  readonly company: string | null
  readonly ledgers: readonly TallyLedger[]
  readonly vouchers: readonly TallyVoucher[]
  readonly errors: readonly {
    readonly index: number
    readonly message: string
  }[]
}

/** "-1,234.50" → -123450n (paise). Tally may add "₹", commas or "Dr"/"Cr". */
export function parseTallyAmount(raw: string): bigint | null {
  let s = raw.replace(/[₹,\s]/g, "")
  if (s === "") return 0n
  let sign = 1n
  if (/Dr$/i.test(s)) {
    s = s.slice(0, -2)
    sign = -1n // Dr is negative in Tally's convention
  } else if (/Cr$/i.test(s)) {
    s = s.slice(0, -2)
  }
  // Forex amounts ("$100 @ ₹83/$ = ₹8300") keep the part after "=".
  const eq = s.lastIndexOf("=")
  if (eq >= 0) s = s.slice(eq + 1)
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return null
  const paise =
    BigInt(m[2] ?? "0") * 100n + BigInt((m[3] ?? "0").padEnd(2, "0"))
  return (m[1] ? -1n : 1n) * sign * paise
}

/** Tally's sign (negative debit) → debit positive. */
const debitPositive = (tally: bigint) => -tally

function tallyDate(raw: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.trim())
  if (!m) return null
  const iso = `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso
    ? null
    : iso
}

const nameOf = (el: XmlElement) =>
  (el.attrs["NAME"] ?? childText(el, "NAME") ?? "").trim() ||
  (descendants(el, "NAME")[0]?.text ?? "").trim()

const yes = (el: XmlElement, tag: string) => /^yes$/i.test(childText(el, tag))

function gstinOf(ledger: XmlElement): string | null {
  const direct = childText(ledger, "PARTYGSTIN") || childText(ledger, "GSTIN")
  const nested = descendants(ledger, "GSTIN")[0]?.text ?? ""
  const v = (direct || nested).trim().toUpperCase()
  return /^[0-9]{2}[0-9A-Z]{13}$/.test(v) ? v : null
}

/** Ledger lines of a voucher, including inventory accounting allocations. */
function voucherLines(v: XmlElement): {
  lines: TallyVoucherLine[]
  bad: string | null
} {
  const entries = [
    ...childrenNamed(v, "ALLLEDGERENTRIES.LIST"),
    ...childrenNamed(v, "LEDGERENTRIES.LIST"),
    ...childrenNamed(v, "ALLINVENTORYENTRIES.LIST").flatMap((i) =>
      childrenNamed(i, "ACCOUNTINGALLOCATIONS.LIST")
    ),
    ...childrenNamed(v, "INVENTORYENTRIES.LIST").flatMap((i) =>
      childrenNamed(i, "ACCOUNTINGALLOCATIONS.LIST")
    ),
  ]
  const lines: TallyVoucherLine[] = []
  for (const e of entries) {
    const ledger = childText(e, "LEDGERNAME").trim()
    const amount = parseTallyAmount(childText(e, "AMOUNT"))
    if (!ledger) return { lines, bad: "a ledger entry has no ledger name" }
    if (amount === null)
      return { lines, bad: `amount "${childText(e, "AMOUNT")}" isn't a number` }
    if (amount !== 0n)
      lines.push({ ledger, amountPaise: debitPositive(amount) })
  }
  return { lines, bad: null }
}

/**
 * Reads a Tally XML export (masters, vouchers or both). Groups resolve to
 * their primary group through any number of user-defined levels. Cancelled
 * and optional vouchers are skipped. Problems are returned per item, never
 * thrown, except for XML that can't be read at all.
 */
export function readTally(xml: string): TallyData {
  const root = parseXml(xml)
  const messages = descendants(root, "TALLYMESSAGE")
  const items =
    messages.length > 0 ? messages.flatMap((m) => m.children) : root.children
  const errors: { index: number; message: string }[] = []

  const groupParent = new Map<string, string>()
  for (const g of items.filter((i) => i.name === "GROUP"))
    groupParent.set(nameOf(g), childText(g, "PARENT").trim())

  const natureOf = (parent: string): TallyNature | null => {
    let cur = parent
    for (let depth = 0; depth < 20; depth++) {
      if (cur in PRIMARY_GROUPS)
        return PRIMARY_GROUPS[cur as keyof typeof PRIMARY_GROUPS]
      const up = groupParent.get(cur)
      if (up === undefined || up === "") return null
      cur = up
    }
    return null
  }

  const ledgers: TallyLedger[] = []
  items.forEach((el, index) => {
    if (el.name !== "LEDGER") return
    const name = nameOf(el)
    const parent = childText(el, "PARENT").trim()
    const opening = parseTallyAmount(childText(el, "OPENINGBALANCE"))
    if (!name) return errors.push({ index, message: "A ledger has no name." })
    if (opening === null)
      return errors.push({
        index,
        message: `${name}: opening balance isn't a number.`,
      })
    const pl = /^profit\s*&\s*loss a\/c$/i.test(name) && !parent
    const nature = pl ? ("profit_and_loss" as const) : natureOf(parent)
    if (!nature)
      errors.push({
        index,
        message: `${name}: group "${parent}" isn't a Tally group we know; it goes to Suspense.`,
      })
    ledgers.push({
      name,
      parent,
      nature,
      openingPaise: debitPositive(opening),
      gstin: gstinOf(el),
    })
  })

  const vouchers: TallyVoucher[] = []
  items.forEach((el, index) => {
    if (el.name !== "VOUCHER") return
    if (yes(el, "ISCANCELLED") || yes(el, "ISOPTIONAL") || yes(el, "ISDELETED"))
      return
    const type = (
      el.attrs["VCHTYPE"] ?? childText(el, "VOUCHERTYPENAME")
    ).trim()
    const number = childText(el, "VOUCHERNUMBER").trim()
    const date = tallyDate(childText(el, "DATE"))
    const label = `${type || "Voucher"} ${number}`.trim()
    if (!date)
      return errors.push({ index, message: `${label}: date isn't YYYYMMDD.` })
    const { lines, bad } = voucherLines(el)
    if (bad) return errors.push({ index, message: `${label}: ${bad}.` })
    if (lines.length === 0) return
    const net = lines.reduce((s, l) => s + l.amountPaise, 0n)
    if (net !== 0n)
      return errors.push({
        index,
        message: `${label} on ${date} doesn't balance.`,
      })
    vouchers.push({
      guid: childText(el, "GUID").trim() || null,
      date,
      type,
      number,
      narration: childText(el, "NARRATION").trim(),
      lines,
    })
  })

  const company =
    descendants(root, "SVCURRENTCOMPANY")[0]?.text.trim() ||
    items.find((i) => i.name === "COMPANY")?.attrs["NAME"] ||
    null
  return { company, ledgers, vouchers, errors }
}

/**
 * Closing balance per Tally ledger implied by the file: opening plus every
 * voucher line. The import's trial-balance check compares this with what
 * Median booked.
 */
export function closingBalances(
  ledgers: readonly Pick<TallyLedger, "name" | "openingPaise">[],
  vouchers: readonly Pick<TallyVoucher, "lines">[]
): Map<string, bigint> {
  const out = new Map<string, bigint>()
  for (const l of ledgers)
    out.set(l.name, (out.get(l.name) ?? 0n) + l.openingPaise)
  for (const v of vouchers)
    for (const line of v.lines)
      out.set(line.ledger, (out.get(line.ledger) ?? 0n) + line.amountPaise)
  return out
}
