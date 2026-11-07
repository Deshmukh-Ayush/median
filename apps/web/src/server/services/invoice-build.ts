// Pure invoice and credit-note building: GST per rules 5–7 via
// @workspace/ledger, the journal lines, numbering and status. No database,
// so every rule here is unit-tested.

import { ServiceError } from "@workspace/contracts"
import type { InvoiceStatus, InvoiceSupplyType } from "@workspace/contracts"
import {
  computeDocument,
  paise,
  quantityMilliOf,
  resolveSupply,
} from "@workspace/ledger"
import type { DocumentTotals, LineTax, Money } from "@workspace/ledger"

/** The org's GST profile, as invoicing needs it. */
export interface OrgGst {
  readonly stateCode: string | null
  readonly gstRegistered: boolean
  readonly compositionScheme: boolean
}

export interface BuildLineInput {
  readonly description: string
  readonly hsnSac: string
  readonly quantity: string
  readonly unitPrice: Money
  readonly gstRateBps: number
  readonly revenueAccountId?: string | null | undefined
}

export interface BuildInvoiceInput {
  readonly placeOfSupply?: string | null | undefined
  readonly specialSupply?:
    "export_with_payment" | "export_lut" | "sez" | null | undefined
  readonly reverseCharge: boolean
  readonly lines: readonly BuildLineInput[]
}

export interface BuiltLine extends BuildLineInput, LineTax {
  readonly quantityMilli: bigint
}

export interface BuiltInvoice {
  readonly placeOfSupply: string
  readonly supplyType: InvoiceSupplyType
  readonly intrastate: boolean
  readonly chargesGst: boolean
  readonly lines: readonly BuiltLine[]
  readonly totals: DocumentTotals
  readonly warnings: readonly string[]
}

/** GST place of supply for exports ("Other countries"). */
export const EXPORT_PLACE_OF_SUPPLY = "96"

/**
 * Rules 6–7: resolves the supply type and computes every line and the
 * totals. Throws VALIDATION when there's no state to compare against or the
 * invoice comes to zero.
 */
export function buildInvoice(
  input: BuildInvoiceInput,
  org: OrgGst,
  party: { readonly stateCode: string | null; readonly gstin: string | null }
): BuiltInvoice {
  const orgState = org.stateCode
  const placeOfSupply =
    input.placeOfSupply ??
    (input.specialSupply === "export_with_payment" ||
    input.specialSupply === "export_lut"
      ? EXPORT_PLACE_OF_SUPPLY
      : (party.stateCode ?? orgState))
  if (!orgState || !placeOfSupply)
    throw new ServiceError(
      "VALIDATION",
      "Set your business's GST state in Settings before invoicing."
    )
  const supply = resolveSupply({
    orgStateCode: orgState,
    placeOfSupply,
    special: input.specialSupply ?? null,
  })
  const chargesGst =
    supply.chargesGst &&
    org.gstRegistered &&
    !org.compositionScheme &&
    !input.reverseCharge
  const lineInputs = input.lines.map((l) => ({
    ...l,
    quantityMilli: quantityMilliOf(l.quantity),
  }))
  const { lines, totals } = computeDocument(
    lineInputs.map((l) => ({
      quantityMilli: l.quantityMilli,
      unitPrice: l.unitPrice,
      rateBps: l.gstRateBps,
    })),
    { intrastate: supply.intrastate, chargesGst }
  )
  if (totals.total <= 0n)
    throw new ServiceError("VALIDATION", "The invoice comes to ₹0.")

  const warnings: string[] = []
  if (!org.gstRegistered)
    warnings.push(
      "Your business isn't GST-registered, so this is a bill of supply with no GST."
    )
  else if (org.compositionScheme)
    warnings.push(
      "Composition scheme: this is a bill of supply and charges no GST."
    )
  if (input.reverseCharge && !party.gstin)
    warnings.push("Reverse charge applies only to GST-registered customers.")
  if (input.specialSupply === "sez" && !party.gstin)
    warnings.push("An SEZ supply needs the customer's GSTIN.")
  if (
    (input.specialSupply === "export_with_payment" ||
      input.specialSupply === "export_lut") &&
    placeOfSupply !== EXPORT_PLACE_OF_SUPPLY
  )
    warnings.push(
      `Exports usually have place of supply ${EXPORT_PLACE_OF_SUPPLY} (other countries).`
    )

  return {
    placeOfSupply: supply.placeOfSupply,
    supplyType: supply.supplyType,
    intrastate: supply.intrastate,
    chargesGst,
    lines: lineInputs.map((l, i) => {
      const tax = lines[i]
      if (!tax) throw new Error("unreachable")
      return { ...l, ...tax }
    }),
    totals,
    warnings,
  }
}

/** Accounts a sales document posts to (system accounts of the org). */
export interface SalesAccounts {
  readonly receivables: string
  readonly revenue: string
  readonly outputCgst: string
  readonly outputSgst: string
  readonly outputIgst: string
  readonly roundOff: string
}

export interface EntryLine {
  readonly accountId: string
  readonly partyId: string | null
  readonly debit: Money
  readonly credit: Money
  readonly description: string | null
  readonly dimensions: Record<string, string> | null
}

/**
 * Journal lines for an invoice (Dr receivables, Cr revenue and output GST)
 * or a credit note (the mirror). Revenue is one line per income account and
 * rate, tagged with `gst_rate_bps` so a later refund can reverse at the same
 * rate. Round-off goes to Round-off on whichever side balances.
 */
export function salesEntryLines(
  kind: "invoice" | "credit_note",
  doc: {
    readonly lines: readonly Pick<
      BuiltLine,
      "taxable" | "cgst" | "sgst" | "igst" | "gstRateBps" | "revenueAccountId"
    >[]
    readonly totals: DocumentTotals
  },
  accounts: SalesAccounts,
  ref: {
    readonly partyId: string
    readonly documentId: string
    readonly number: string
  }
): EntryLine[] {
  const zero = paise(0n)
  // Invoice: the income side is a credit. Credit note: a debit.
  const income = (
    accountId: string,
    amount: Money,
    description: string | null,
    dimensions: Record<string, string> | null
  ): EntryLine =>
    kind === "invoice"
      ? {
          accountId,
          partyId: null,
          debit: zero,
          credit: amount,
          description,
          dimensions,
        }
      : {
          accountId,
          partyId: null,
          debit: amount,
          credit: zero,
          description,
          dimensions,
        }
  const docKey = kind === "invoice" ? "invoice_id" : "credit_note_id"

  const revenue = new Map<
    string,
    { accountId: string; rate: number; amount: bigint }
  >()
  for (const l of doc.lines) {
    const accountId = l.revenueAccountId ?? accounts.revenue
    const key = `${accountId}:${l.gstRateBps}`
    const prev = revenue.get(key)
    revenue.set(key, {
      accountId,
      rate: l.gstRateBps,
      amount: (prev?.amount ?? 0n) + l.taxable,
    })
  }

  const t = doc.totals
  const lines: EntryLine[] = [
    {
      accountId: accounts.receivables,
      partyId: ref.partyId,
      debit: kind === "invoice" ? t.total : zero,
      credit: kind === "invoice" ? zero : t.total,
      description: ref.number,
      dimensions: { [docKey]: ref.documentId },
    },
    ...[...revenue.values()].map((r) =>
      income(r.accountId, paise(r.amount), null, {
        gst_rate_bps: String(r.rate),
        [docKey]: ref.documentId,
      })
    ),
    income(accounts.outputCgst, t.cgst, "CGST", null),
    income(accounts.outputSgst, t.sgst, "SGST", null),
    income(accounts.outputIgst, t.igst, "IGST", null),
  ]
  // A positive round-off adds to the total, so it sits on the income side.
  if (t.roundOff > 0n)
    lines.push(income(accounts.roundOff, t.roundOff, "Round-off", null))
  if (t.roundOff < 0n)
    lines.push(
      kind === "invoice"
        ? {
            accountId: accounts.roundOff,
            partyId: null,
            debit: paise(0n - t.roundOff),
            credit: zero,
            description: "Round-off",
            dimensions: null,
          }
        : {
            accountId: accounts.roundOff,
            partyId: null,
            debit: zero,
            credit: paise(0n - t.roundOff),
            description: "Round-off",
            dimensions: null,
          }
    )
  return lines.filter((l) => l.debit > 0n || l.credit > 0n)
}

/**
 * Rule 5: "INV/2026-27/0042". Numbers past 9999 drop the slashes so they
 * stay within 16 characters ("INV202627-10000"). Throws VALIDATION if the
 * prefix makes that impossible.
 */
export function documentNumber(
  prefix: string,
  financialYear: string,
  n: number
): string {
  const padded = String(n).padStart(4, "0")
  const full = `${prefix}/${financialYear}/${padded}`
  if (full.length <= 16) return full
  const compact = `${prefix}${financialYear.replace("-", "")}-${padded}`
  if (compact.length <= 16) return compact
  throw new ServiceError(
    "VALIDATION",
    `Document numbers for ${financialYear} have run past 16 characters. Use a shorter prefix.`
  )
}

/** total − paid − credited, never below zero. */
export function outstandingOf(
  total: bigint,
  paid: bigint,
  credited: bigint
): Money {
  const left = total - paid - credited
  return paise(left > 0n ? left : 0n)
}

/**
 * Status from the amounts: nothing left → paid (or cancelled if it was all
 * credited back); something received → partially paid; else issued.
 */
export function invoiceStatusFor(
  total: bigint,
  paid: bigint,
  credited: bigint
): InvoiceStatus {
  if (outstandingOf(total, paid, credited) === 0n)
    return paid > 0n ? "paid" : "cancelled"
  return paid > 0n ? "partially_paid" : "issued"
}

/** What a receipt entry credits to the customer's receivable. */
export function receiptAmount(
  lines: readonly {
    readonly accountId: string
    readonly partyId?: string | null
    readonly credit: bigint
  }[],
  receivablesAccountId: string,
  partyId: string
): Money {
  return paise(
    lines
      .filter(
        (l) => l.accountId === receivablesAccountId && l.partyId === partyId
      )
      .reduce((sum, l) => sum + l.credit, 0n)
  )
}
