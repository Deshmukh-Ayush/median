import type {
  LedgerAccountSummary,
  PartyRef,
  ProposedEntry,
  ProposedEntryView,
} from "@workspace/contracts"

/** Encodes a ProposedEntry for inbox_items.proposed_entry (bigint → string). */
export function encodeProposedEntry(entry: ProposedEntry): unknown {
  return {
    ...entry,
    lines: entry.lines.map((l) => ({
      ...l,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
    })),
  }
}

/**
 * Joins account and party names onto a stored proposal. Accounts and parties
 * are looked up once per page by the caller (no N+1).
 */
export function toProposedEntryView(
  entry: ProposedEntry,
  accounts: ReadonlyMap<string, LedgerAccountSummary>,
  parties: ReadonlyMap<string, PartyRef>
): ProposedEntryView {
  return {
    ...entry,
    lines: entry.lines.map((l) => {
      const account = accounts.get(l.accountId)
      return {
        ...l,
        accountCode: account?.code ?? "",
        accountName: account?.name ?? "Unknown account",
        accountType: account?.type ?? "expense",
        partyName: l.partyId ? (parties.get(l.partyId)?.name ?? null) : null,
      }
    }),
  }
}
