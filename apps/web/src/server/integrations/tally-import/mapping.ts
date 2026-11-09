import type { AccountType } from "@workspace/contracts"

import type { TallyLedger, TallyNature } from "./tally"

// Which Median account (and party) each Tally ledger posts to. Pure: the
// import service loads the chart and parties, then creates what's planned.

export interface ExistingAccount {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly type: AccountType
  readonly systemKey: string | null
}

export type LedgerTarget =
  | { readonly kind: "account"; readonly accountId: string }
  | {
      readonly kind: "party"
      readonly partyKind: "customer" | "vendor"
      /** Trade receivables or payables. */
      readonly accountId: string
      readonly name: string
      readonly gstin: string | null
    }
  | {
      readonly kind: "new_account"
      readonly code: string
      readonly name: string
      readonly type: AccountType
      readonly isBank: boolean
    }

const RANGES: Readonly<
  Record<
    Exclude<TallyNature, "debtor" | "creditor" | "suspense">,
    readonly [AccountType, number, number]
  >
> = {
  bank: ["asset", 1111, 1199],
  cash: ["asset", 1101, 1109],
  current_asset: ["asset", 1300, 1399],
  loan_advance: ["asset", 1300, 1399],
  stock: ["asset", 1500, 1599],
  fixed_asset: ["asset", 1600, 1699],
  investment: ["asset", 1800, 1999],
  duty_tax: ["liability", 2200, 2299],
  current_liability: ["liability", 2300, 2399],
  provision: ["liability", 2400, 2489],
  loan: ["liability", 2500, 2599],
  other_long_term_liability: ["liability", 2600, 2999],
  capital: ["equity", 3100, 3199],
  reserve: ["equity", 3200, 3899],
  sales: ["income", 4000, 4499],
  other_income: ["income", 4500, 4999],
  direct_expense: ["expense", 5000, 5099],
  indirect_expense: ["expense", 5200, 5789],
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

/** GST and TDS ledgers that map onto the system accounts the rules use. */
function systemKeyFor(l: TallyLedger): string | null {
  const n = norm(l.name)
  if (l.nature === "profit_and_loss") return "retained_earnings"
  if (l.nature === "suspense") return "suspense"
  if (l.nature === "duty_tax") {
    const head = /\bigst\b/.test(n)
      ? "igst"
      : /\bcgst\b/.test(n)
        ? "cgst"
        : /\b(sgst|utgst)\b/.test(n)
          ? "sgst"
          : null
    if (head && /\binput\b/.test(n)) return `gst_input_${head}`
    if (head && /\boutput\b/.test(n)) return `gst_output_${head}`
    if (/\btds\b/.test(n)) return "tds_payable"
  }
  if (
    (l.nature === "current_asset" || l.nature === "loan_advance") &&
    /\btds\b/.test(n)
  )
    return "tds_receivable"
  return null
}

export interface MappingPlan {
  readonly targets: ReadonlyMap<string, LedgerTarget>
  readonly warnings: readonly string[]
}

/**
 * Plans where each Tally ledger goes:
 *   1. Sundry Debtors / Creditors → a customer / vendor on trade receivables
 *      / payables.
 *   2. GST, TDS, P&L and Suspense ledgers recognised by name → the system
 *      account.
 *   3. An existing account with the same name.
 *   4. Otherwise a new account, type and code from the Tally group's
 *      Schedule III range (codes skip any already taken).
 */
export function planMapping(
  ledgers: readonly TallyLedger[],
  existing: readonly ExistingAccount[]
): MappingPlan {
  const warnings: string[] = []
  const targets = new Map<string, LedgerTarget>()
  const bySystem = new Map(
    existing.flatMap((a) => (a.systemKey ? [[a.systemKey, a.id]] : []))
  )
  const byName = new Map(existing.map((a) => [norm(a.name), a.id]))
  const taken = new Set(existing.map((a) => a.code))
  const nextCode = (from: number, to: number): string | null => {
    for (let c = from; c <= to; c++) {
      const code = String(c)
      if (!taken.has(code)) {
        taken.add(code)
        return code
      }
    }
    return null
  }
  const system = (key: string) => {
    const id = bySystem.get(key)
    if (!id)
      throw new Error(`Chart of accounts is missing the system account ${key}`)
    return id
  }

  for (const l of ledgers) {
    if (targets.has(l.name)) continue
    if (l.nature === "debtor" || l.nature === "creditor") {
      targets.set(l.name, {
        kind: "party",
        partyKind: l.nature === "debtor" ? "customer" : "vendor",
        accountId: system(
          l.nature === "debtor" ? "trade_receivables" : "trade_payables"
        ),
        name: l.name,
        gstin: l.gstin,
      })
      continue
    }
    // A ledger the file has no master for: same name, else Suspense.
    if (l.nature === null) {
      const same = byName.get(norm(l.name))
      if (!same)
        warnings.push(
          `${l.name}: no ledger master or matching account; posted to Suspense.`
        )
      targets.set(l.name, {
        kind: "account",
        accountId: same ?? system("suspense"),
      })
      continue
    }
    const key = systemKeyFor(l)
    if (key) {
      targets.set(l.name, { kind: "account", accountId: system(key) })
      continue
    }
    const same = byName.get(norm(l.name))
    if (same) {
      targets.set(l.name, { kind: "account", accountId: same })
      continue
    }
    const nature = l.nature as keyof typeof RANGES
    const range = RANGES[nature]
    const code = nextCode(range[1], range[2])
    if (!code) {
      warnings.push(
        `${l.name}: no free account code in ${range[1]}–${range[2]}; posted to Suspense.`
      )
      targets.set(l.name, { kind: "account", accountId: system("suspense") })
      continue
    }
    if (nature === "duty_tax" && /\b(c|s|i|ut)gst\b/.test(norm(l.name)))
      warnings.push(
        `${l.name}: a GST ledger without "Input" or "Output" in its name gets its own account; GST reports won't include it until it's split.`
      )
    targets.set(l.name, {
      kind: "new_account",
      code,
      name: l.name,
      type: range[0],
      isBank: nature === "bank",
    })
  }
  return { targets, warnings }
}
