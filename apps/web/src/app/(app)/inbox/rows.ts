import { addMoney, paise } from "@workspace/ledger"

import type { InboxLineView, InboxRowView } from "@/components/inbox/inbox-view"
import { formatDate, formatDateTime } from "@/lib/format-date"
import type { InboxItem, InboxItemKind } from "@/server/services"

export const KIND_LABELS: Record<InboxItemKind, string> = {
  bill: "Bill",
  bank_line: "Bank line",
  razorpay_record: "Razorpay payment",
  settlement_gap: "Settlement gap",
}

const SOURCE_LABELS: Record<InboxItem["sourceRef"]["type"], string> = {
  document: "Source document",
  source_record: "Source record",
}

/** "18%" from 1800 basis points; no rounding, it's integer division. */
function percent(bps: number): string {
  const whole = Math.trunc(bps / 100)
  const fraction = bps % 100
  return fraction === 0
    ? `${whole}%`
    : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}%`
}

/**
 * Prepares an inbox item for display. Account and party names come on each
 * line from the service. No tax maths: lines and GST are shown as proposed.
 */
export function toInboxRow(item: InboxItem): InboxRowView {
  const goesTo: InboxLineView[] = []
  const comesFrom: InboxLineView[] = []
  let total = paise(0n)
  for (const line of item.proposedEntry.lines) {
    const account = line.partyName
      ? `${line.accountName} · ${line.partyName}`
      : line.accountName
    if (line.debit > 0n) {
      goesTo.push({
        account,
        amount: line.debit,
        description: line.description,
      })
      total = addMoney(total, line.debit)
    }
    if (line.credit > 0n) {
      comesFrom.push({
        account,
        amount: line.credit,
        description: line.description,
      })
    }
  }
  return {
    id: item.id,
    kindLabel: KIND_LABELS[item.kind],
    confidence: item.confidence,
    reason: item.reason,
    narration: item.proposedEntry.narration,
    entryDate: formatDate(item.proposedEntry.entryDate),
    createdAt: formatDateTime(item.createdAt),
    amount: total,
    goesTo,
    comesFrom,
    sourceLabel: SOURCE_LABELS[item.sourceRef.type],
    sourceUrl: item.sourceDocumentUrl,
    gst: item.gst
      ? {
          taxable: item.gst.taxable,
          cgst: item.gst.cgst,
          sgst: item.gst.sgst,
          igst: item.gst.igst,
          rateLabel:
            item.gst.rateBps === null ? null : percent(item.gst.rateBps),
          interstate: item.gst.supplyType === "interstate",
        }
      : null,
    tds: item.tds
      ? {
          section: item.tds.section,
          rate: percent(item.tds.rateBps).replace("%", ""),
          amount: item.tds.amount,
        }
      : null,
    // Only kinds whose tax the reviewer can correct get the edit form.
    taxEditable: item.kind === "bill" || item.gst !== null || item.tds !== null,
    flags: item.reviewFlags.needsReview.map((f) => ({
      field: f.field,
      reason: f.reason,
    })),
    refund: item.refund
      ? {
          href: `/invoices/${item.refund.invoiceId}/credit-note?refund=${item.refund.amount.toString()}`,
          invoiceNumber: item.refund.invoiceNumber,
          amount: item.refund.amount,
        }
      : null,
  }
}
