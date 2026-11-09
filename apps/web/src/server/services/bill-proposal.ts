// Turns a validated bill extraction into a proposed purchase entry. The AI
// only copied text off the bill; every amount here is parsed and every tax
// is recomputed in code (rules 1, 7, 13). Printed amounts are used only to
// cross-check, and anything doubtful becomes a review flag. Pure: no
// database, so it's unit-tested.

import {
  CONFIDENCE_MEDIUM,
  ServiceError,
  isoDateSchema,
} from "@workspace/contracts"
import type {
  BillExtraction,
  InboxGstSplit,
  ProposedEntry,
  ProposedLine,
  ReviewFlag,
} from "@workspace/contracts"
import {
  InvalidMoneyError,
  formatInr,
  paise,
  parseRupees,
  splitTax,
  taxOn,
} from "@workspace/ledger"
import type { Money } from "@workspace/ledger"

export interface BillAccounts {
  /** Where the cost goes: the vendor's usual account, else Suspense. */
  readonly expense: string
  /** False when `expense` is Suspense (no history for this vendor). */
  readonly expenseKnown: boolean
  readonly payables: string
  readonly inputCgst: string
  readonly inputSgst: string
  readonly inputIgst: string
  readonly roundOff: string
}

export interface BillContext {
  readonly org: {
    readonly stateCode: string | null
    /** GST-registered and not under composition: input tax credit applies. */
    readonly claimsItc: boolean
  }
  readonly accounts: BillAccounts
  readonly vendor: {
    readonly partyId: string | null
    /** Added from this bill's GSTIN just now. */
    readonly isNew: boolean
  }
  /** Rate from the HSN/SAC master for lines whose rate isn't printed. */
  readonly masterRates: ReadonlyMap<number, number>
  /** A bill with the same vendor and number already in the inbox or books. */
  readonly duplicate: boolean
}

export interface BillProposal {
  readonly entry: ProposedEntry
  readonly gst: InboxGstSplit
  readonly flags: readonly ReviewFlag[]
  readonly confidence: number
  readonly reason: string
}

/** "18", "18%", "18.00 %" → 1800 bps. Null when it isn't a plain percentage. */
export function printedRateBps(printed: string | null): number | null {
  const match = printed
    ? /^(\d{1,2})(?:\.(\d{1,2}))?\s*%?$/.exec(printed.trim())
    : null
  if (!match) return null
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
}

const ZERO = paise(0n)

function amount(text: string, field: string): Money {
  try {
    const value = parseRupees(text)
    if (value < 0n) throw new InvalidMoneyError("negative")
    return value
  } catch (error) {
    if (!(error instanceof InvalidMoneyError)) throw error
    throw new ServiceError("VALIDATION", `Can't read the amount at ${field}.`, {
      field,
      text,
    })
  }
}

function optionalAmount(text: string | null | undefined): Money | null {
  if (!text) return null
  try {
    return parseRupees(text)
  } catch {
    return null
  }
}

const check = (field: string, reason: string): ReviewFlag => ({
  field,
  kind: "needs_review",
  reason,
  source: "check",
})

/** Flags `field` when a printed amount differs from ours by more than ₹1. */
function crossCheck(
  flags: ReviewFlag[],
  field: string,
  printed: string | null | undefined,
  computed: bigint
): void {
  const p = optionalAmount(printed)
  if (p === null) return
  const diff = p > computed ? p - computed : computed - p
  if (diff > 100n)
    flags.push(
      check(
        field,
        `Printed ${formatInr(p)}, but it works out to ${formatInr(paise(computed))}.`
      )
    )
}

/**
 * Builds the purchase entry: Dr expense (taxable, plus the tax when no
 * input credit applies), Dr input CGST/SGST or IGST, Cr the vendor's payable,
 * with Round-off when the printed total is the rupee-rounded one. Throws
 * VALIDATION for a non-INR bill, a bad date or an unreadable amount.
 */
export function buildBillProposal(
  bill: BillExtraction,
  aiFlags: readonly ReviewFlag[],
  ctx: BillContext
): BillProposal {
  if (bill.currency.trim().toUpperCase() !== "INR")
    throw new ServiceError(
      "VALIDATION",
      `This bill is in ${bill.currency}. Only rupee bills can be booked for now.`
    )
  const billDate = isoDateSchema.safeParse(bill.billDate)
  if (!billDate.success)
    throw new ServiceError("VALIDATION", "Can't read the bill date.", {
      field: "billDate",
    })

  const flags: ReviewFlag[] = []
  // Supply type (rule 6, from the buyer's side): the vendor's state vs the
  // place of supply. Unknown vendor state → compare with our own state.
  const gstinState = /^\d{2}/.test(bill.vendor.gstin ?? "")
    ? (bill.vendor.gstin ?? "").slice(0, 2)
    : null
  const vendorState = gstinState ?? bill.vendor.stateCode
  const placeOfSupply = bill.placeOfSupplyStateCode ?? ctx.org.stateCode
  const intrastate =
    vendorState && placeOfSupply
      ? vendorState === placeOfSupply
      : placeOfSupply === ctx.org.stateCode
  if (!vendorState)
    flags.push(
      check(
        "vendor.stateCode",
        "The vendor's state isn't on the bill: check CGST+SGST vs IGST."
      )
    )

  let taxable = 0n
  let tax = 0n
  let cgst = 0n
  let sgst = 0n
  let igst = 0n
  const rates = new Set<number>()
  bill.lines.forEach((line, i) => {
    const field = `lines[${i}]`
    const lineTaxable = amount(line.taxableAmount, `${field}.taxableAmount`)
    let rate = printedRateBps(line.gstRatePercent)
    if (rate === null) {
      rate = ctx.masterRates.get(i) ?? null
      flags.push(
        check(
          `${field}.gstRatePercent`,
          rate === null
            ? "No GST rate on this line: set it before approving."
            : `No GST rate printed; ${rate / 100}% taken from the HSN/SAC master.`
        )
      )
    }
    const lineTax = taxOn(lineTaxable, rate ?? 0)
    const split = splitTax(lineTax, intrastate)
    crossCheck(flags, `${field}.cgstAmount`, line.cgstAmount, split.cgst)
    crossCheck(flags, `${field}.sgstAmount`, line.sgstAmount, split.sgst)
    crossCheck(flags, `${field}.igstAmount`, line.igstAmount, split.igst)
    rates.add(rate ?? 0)
    taxable += lineTaxable
    tax += lineTax
    cgst += split.cgst
    sgst += split.sgst
    igst += split.igst
  })
  const p = bill.printedTotals
  crossCheck(flags, "printedTotals.taxable", p.taxable, taxable)
  crossCheck(flags, "printedTotals.cgst", p.cgst, cgst)
  crossCheck(flags, "printedTotals.sgst", p.sgst, sgst)
  crossCheck(flags, "printedTotals.igst", p.igst, igst)
  if (
    intrastate &&
    (optionalAmount(p.igst) ?? 0n) > 0n &&
    (optionalAmount(p.cgst) ?? 0n) === 0n
  )
    flags.push(
      check(
        "printedTotals.igst",
        "The bill charges IGST, but the vendor looks to be in the same state."
      )
    )

  // Rule 7: bills are usually rounded to the rupee. Follow the printed
  // total when it's our exact total or that rounded; otherwise flag it.
  const exact = taxable + tax
  const rounded = ((2n * exact + 100n) / 200n) * 100n
  const printedTotal = optionalAmount(p.total)
  let total = exact
  if (printedTotal === rounded) total = rounded
  else if (printedTotal !== null && printedTotal !== exact)
    flags.push(
      check(
        "printedTotals.total",
        `Printed total ${formatInr(printedTotal)}, but the lines add up to ${formatInr(paise(exact))}.`
      )
    )
  const roundOff = total - exact

  if (!ctx.org.claimsItc && tax > 0n)
    flags.push({
      field: "gst",
      kind: "not_printed",
      reason:
        "No input tax credit (not GST-registered, or composition): the GST is part of the cost.",
      source: "check",
    })
  if (!ctx.vendor.partyId)
    flags.push(
      check(
        "vendor.gstin",
        "No GSTIN to identify this vendor: add or pick the vendor before approving."
      )
    )
  if (!ctx.accounts.expenseKnown)
    flags.push(
      check(
        "expenseAccount",
        "First bill from this vendor: choose the expense account (it's in Suspense)."
      )
    )
  if (ctx.duplicate)
    flags.push(
      check(
        "billNumber",
        `Bill ${bill.billNumber} from this vendor is already in Median. Is this a duplicate?`
      )
    )

  const a = ctx.accounts
  const dr = (
    accountId: string,
    value: bigint,
    description: string | null = null
  ): ProposedLine => ({
    accountId,
    partyId: null,
    debit: paise(value),
    credit: ZERO,
    description,
  })
  const lines: ProposedLine[] = ctx.org.claimsItc
    ? [
        dr(a.expense, taxable),
        dr(a.inputCgst, cgst, "CGST"),
        dr(a.inputSgst, sgst, "SGST"),
        dr(a.inputIgst, igst, "IGST"),
      ]
    : [dr(a.expense, exact)]
  if (roundOff > 0n) lines.push(dr(a.roundOff, roundOff, "Round-off"))
  if (roundOff < 0n)
    lines.push({
      accountId: a.roundOff,
      partyId: null,
      debit: ZERO,
      credit: paise(0n - roundOff),
      description: "Round-off",
    })
  lines.push({
    accountId: a.payables,
    partyId: ctx.vendor.partyId,
    debit: ZERO,
    credit: paise(total),
    description: `Bill ${bill.billNumber}`,
  })

  const needsReview =
    aiFlags.length + flags.filter((f) => f.kind === "needs_review").length
  const confidence =
    !a.expenseKnown || !ctx.vendor.partyId || ctx.duplicate
      ? 0.5
      : needsReview > 0
        ? CONFIDENCE_MEDIUM - 0.1
        : 0.8
  const vendor = `${bill.vendor.name}${ctx.vendor.isNew ? " (new vendor)" : ""}`
  return {
    entry: {
      entryDate: billDate.data,
      narration: `${bill.vendor.name} bill ${bill.billNumber}`.slice(0, 500),
      lines: lines.filter((l) => l.debit > 0n || l.credit > 0n),
    },
    gst: {
      taxable: paise(taxable),
      cgst: paise(ctx.org.claimsItc ? cgst : 0n),
      sgst: paise(ctx.org.claimsItc ? sgst : 0n),
      igst: paise(ctx.org.claimsItc ? igst : 0n),
      rateBps: rates.size === 1 ? ([...rates][0] ?? null) : null,
      supplyType: ctx.org.claimsItc
        ? intrastate
          ? "intrastate"
          : "interstate"
        : null,
    },
    flags,
    confidence,
    reason:
      needsReview > 0
        ? `Bill ${bill.billNumber} from ${vendor}: ${needsReview} thing(s) to check.`
        : `Bill ${bill.billNumber} from ${vendor}, ${formatInr(paise(total))}.`,
  }
}
