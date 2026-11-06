import "server-only"

import {
  CONFIDENCE_MEDIUM,
  billExtractionSchema,
  billReviewSchema,
  idSchema,
  parseInput,
} from "@workspace/contracts"
import type { BillReviewInput, InboxItem, PartyRef } from "@workspace/contracts"
import { paise, parseRupees, splitTax, taxOn } from "@workspace/ledger"

import { requireConsent } from "./consent"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { toProposedEntryView } from "./proposed-entry"
import { STUB_ACCOUNTS, STUB_ACCOUNT_LIST, STUB_PARTIES } from "./stub-data"

/**
 * Moved to @workspace/contracts; re-exported so imports from this file keep
 * working. Import it from "@workspace/contracts".
 */
export { billExtractionSchema }
export type { BillExtraction } from "@workspace/contracts"

/** "18" or "18%" → 1800 bps. Null when it isn't a plain percentage. */
function rateBps(printed: string | null): number | null {
  const match = printed
    ? /^(\d{1,2})(?:\.(\d{1,2}))?%?$/.exec(printed.trim())
    : null
  if (!match) return null
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
}

/**
 * Turns a validated bill extraction into a pending purchase entry with input
 * tax credit. Tax and totals are computed in code; the AI's output is only
 * read. `review` carries the review-check flags (needsReview, notPrinted) to
 * the inbox item. Throws VALIDATION if either doesn't match its schema,
 * CONSENT_REQUIRED until data-processing consent is recorded.
 * STUB: books to a fixed expense account and vendor, intrastate; Day 4 resolves
 * accounts, parties and supply type.
 */
export async function createInboxItemFromExtraction(
  ctx: OrgContext,
  documentId: string,
  extraction: unknown,
  review: BillReviewInput = {}
): Promise<InboxItem> {
  assertCan(ctx, "ledger", "propose")
  const docId = parseInput(idSchema, documentId)
  const bill = parseInput(billExtractionSchema, extraction)
  const flags = parseInput(billReviewSchema, review)
  await requireConsent(ctx)

  let taxable = 0n
  let tax = 0n
  for (const line of bill.lines) {
    const lineTaxable = parseRupees(line.taxableAmount)
    taxable += lineTaxable
    tax += taxOn(lineTaxable, rateBps(line.gstRatePercent) ?? 1800)
  }
  const split = splitTax(paise(tax), true)
  const total = paise(taxable + tax)

  await Promise.resolve()
  return {
    id: crypto.randomUUID(),
    kind: "bill",
    status: "pending",
    confidence: flags.needsReview.length > 0 ? CONFIDENCE_MEDIUM - 0.1 : 0.8,
    reason:
      flags.needsReview.length > 0
        ? `Bill ${bill.billNumber} from ${bill.vendor.name}: ${flags.needsReview.length} field(s) need a check.`
        : `Bill ${bill.billNumber} from ${bill.vendor.name}. Check the expense account.`,
    sourceRef: { type: "document", id: docId },
    sourceDocumentUrl: null,
    proposedEntry: toProposedEntryView(
      {
        entryDate: bill.billDate,
        narration: `${bill.vendor.name} bill ${bill.billNumber}`,
        lines: [
          {
            accountId: STUB_ACCOUNTS.hosting.id,
            partyId: null,
            debit: paise(taxable),
            credit: paise(0n),
            description: null,
          },
          {
            accountId: STUB_ACCOUNTS.inputCgst.id,
            partyId: null,
            debit: split.cgst,
            credit: paise(0n),
            description: "CGST",
          },
          {
            accountId: STUB_ACCOUNTS.inputSgst.id,
            partyId: null,
            debit: split.sgst,
            credit: paise(0n),
            description: "SGST",
          },
          {
            accountId: STUB_ACCOUNTS.payables.id,
            partyId: STUB_PARTIES.aws.id,
            debit: paise(0n),
            credit: total,
            description: null,
          },
        ],
      },
      new Map(STUB_ACCOUNT_LIST.map((a) => [a.id, a])),
      new Map<string, PartyRef>([[STUB_PARTIES.aws.id, STUB_PARTIES.aws]])
    ),
    gst: {
      taxable: paise(taxable),
      cgst: split.cgst,
      sgst: split.sgst,
      igst: split.igst,
      rateBps: null,
      supplyType: "intrastate",
    },
    tds: null,
    reviewFlags: flags,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    postedEntryId: null,
    createdAt: new Date().toISOString(),
  }
}
