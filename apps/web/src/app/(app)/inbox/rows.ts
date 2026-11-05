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

/**
 * Prepares an inbox item for display. Names come from lookup maps (one list
 * call each, not one per line). No tax maths: lines are shown as proposed.
 */
export function toInboxRow(
  item: InboxItem,
  accountNames: ReadonlyMap<string, string>,
  partyNames: ReadonlyMap<string, string>
): InboxRowView {
  const name = (accountId: string, partyId: string | null) => {
    const account = accountNames.get(accountId) ?? "Unknown account"
    const party = partyId ? partyNames.get(partyId) : undefined
    return party ? `${account} · ${party}` : account
  }
  const goesTo: InboxLineView[] = []
  const comesFrom: InboxLineView[] = []
  let total = paise(0n)
  for (const line of item.proposedEntry.lines) {
    if (line.debit > 0n) {
      goesTo.push({
        account: name(line.accountId, line.partyId),
        amount: line.debit,
        description: line.description,
      })
      total = addMoney(total, line.debit)
    }
    if (line.credit > 0n) {
      comesFrom.push({
        account: name(line.accountId, line.partyId),
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
  }
}
