// Applies a reviewer's inbox edits to a proposed entry. Pure: GST and TDS
// edits rebuild the tax and TDS lines in code (the UI never computes tax);
// the result is then checked for balance by the ledger on posting.

import { ServiceError } from "@workspace/contracts"
import type {
  InboxGstSplit,
  InboxTds,
  ProposedEntry,
  ProposedLine,
} from "@workspace/contracts"
import { paise } from "@workspace/ledger"
import type { Money } from "@workspace/ledger"

export interface TaxAccounts {
  readonly outputCgst: string
  readonly outputSgst: string
  readonly outputIgst: string
  readonly inputCgst: string
  readonly inputSgst: string
  readonly inputIgst: string
  readonly tdsReceivable: string
  readonly receivables: string
}

export interface ParsedEdits {
  readonly entryDate?: string | undefined
  readonly narration?: string | undefined
  readonly lines?: readonly ProposedLine[] | undefined
  readonly gst?:
    | {
        readonly taxable: Money
        readonly cgst: Money
        readonly sgst: Money
        readonly igst: Money
      }
    | undefined
  readonly tds?: InboxTds | null | undefined
}

const ZERO = paise(0n)
const amountOf = (l: ProposedLine) => (l.debit > 0n ? l.debit : l.credit)
const isDebit = (l: ProposedLine) => l.debit > 0n

export function applyInboxEdits(
  entry: ProposedEntry,
  current: {
    readonly gst: InboxGstSplit | null
    readonly tds: InboxTds | null
  },
  edits: ParsedEdits,
  accounts: TaxAccounts
): { entry: ProposedEntry; gst: InboxGstSplit | null; tds: InboxTds | null } {
  let lines: ProposedLine[] = [...(edits.lines ?? entry.lines)]
  let gst = current.gst
  let tds = current.tds

  if (edits.gst) {
    const g = edits.gst
    const output = [
      accounts.outputCgst,
      accounts.outputSgst,
      accounts.outputIgst,
    ]
    const input = [accounts.inputCgst, accounts.inputSgst, accounts.inputIgst]
    const hasOutput = lines.some((l) => output.includes(l.accountId))
    const hasInput = lines.some((l) => input.includes(l.accountId))
    // Sales carry output GST on the credit side; purchases input GST as debits.
    const sale =
      hasOutput ||
      (!hasInput && lines.some((l) => l.accountId === accounts.receivables))
    const [cgstId, sgstId, igstId] = sale ? output : input
    const taxIds = sale ? output : input
    const oldTaxable = current.gst?.taxable
    const taxableIndex = lines.findIndex(
      (l) =>
        !taxIds.includes(l.accountId) &&
        isDebit(l) === !sale &&
        oldTaxable !== undefined &&
        amountOf(l) === oldTaxable
    )
    if (taxableIndex < 0)
      throw new ServiceError(
        "VALIDATION",
        "Couldn't find the taxable line to update. Edit the lines directly."
      )
    lines = lines.map((l, i) =>
      i === taxableIndex
        ? {
            ...l,
            debit: sale ? ZERO : g.taxable,
            credit: sale ? g.taxable : ZERO,
          }
        : l
    )
    lines = lines.filter((l) => !taxIds.includes(l.accountId))
    const taxLine = (
      accountId: string | undefined,
      amount: Money,
      label: string
    ): ProposedLine[] =>
      accountId && amount > 0n
        ? [
            {
              accountId,
              partyId: null,
              debit: sale ? ZERO : amount,
              credit: sale ? amount : ZERO,
              description: label,
            },
          ]
        : []
    lines.splice(
      taxableIndex + 1,
      0,
      ...taxLine(cgstId, g.cgst, "CGST"),
      ...taxLine(sgstId, g.sgst, "SGST"),
      ...taxLine(igstId, g.igst, "IGST")
    )
    gst = {
      taxable: g.taxable,
      cgst: g.cgst,
      sgst: g.sgst,
      igst: g.igst,
      rateBps: null,
      supplyType:
        g.igst > 0n ? "interstate" : g.cgst + g.sgst > 0n ? "intrastate" : null,
    }
  }

  if (edits.tds !== undefined) {
    const oldTds = lines.find(
      (l) => l.accountId === accounts.tdsReceivable && isDebit(l)
    )
    const before = oldTds?.debit ?? 0n
    const after = edits.tds?.amount ?? 0n
    const receivable = lines.findIndex(
      (l) => l.accountId === accounts.receivables && !isDebit(l)
    )
    if (receivable < 0)
      throw new ServiceError(
        "VALIDATION",
        "TDS applies to receipts against an invoice."
      )
    lines = lines.filter((l) => l !== oldTds)
    // Received + TDS settles the receivable: move the difference there.
    lines = lines.map((l) =>
      l.accountId === accounts.receivables && !isDebit(l)
        ? { ...l, credit: paise(l.credit - before + after) }
        : l
    )
    if (edits.tds && after > 0n) {
      const partyId =
        lines.find((l) => l.accountId === accounts.receivables)?.partyId ?? null
      lines.push({
        accountId: accounts.tdsReceivable,
        partyId,
        debit: paise(after),
        credit: ZERO,
        description: `TDS ${edits.tds.section} @ ${edits.tds.rateBps / 100}%`,
      })
    }
    tds = edits.tds
  }

  return {
    entry: {
      entryDate: edits.entryDate ?? entry.entryDate,
      narration: edits.narration ?? entry.narration,
      lines: lines.filter((l) => l.debit > 0n || l.credit > 0n),
    },
    gst,
    tds,
  }
}
