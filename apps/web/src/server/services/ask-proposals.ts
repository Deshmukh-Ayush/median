import "server-only"

import { ServiceError } from "@workspace/contracts"
import type { InvoicePreview, ProposedEntry , GST_RATES_BPS} from "@workspace/contracts"
import { paise } from "@workspace/ledger"

import { withTransaction } from "../db"
import { auditLog, inboxItems } from "../db/schema"
import { listLedgerAccounts } from "./accounts"
import { checkJournalLines } from "./ask-proposal-schema"
import type { AskProposal, JournalLineInput } from "./ask-proposal-schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { encodeGst } from "./inbox"
import { invoiceProposalEntry, previewInvoice } from "./invoices"
import { listParties } from "./parties"
import { getDefaultPaymentTerms } from "./payment-terms"
import { encodeProposedEntry } from "./proposed-entry"

// Ask Median's write path: it proposes, a person approves in the inbox.
// Nothing here posts to the ledger.

export const ASK_PROPOSAL_REASON = "Proposed by Ask Median"

function pickOne<T extends { name: string }>(
  what: string,
  name: string,
  rows: readonly T[]
): T {
  const wanted = name.trim().toLowerCase()
  const exact = rows.filter((r) => r.name.toLowerCase() === wanted)
  if (exact.length === 1) return exact[0]!
  if (exact.length === 0 && rows.length === 1) return rows[0]!
  if (rows.length === 0)
    throw new ServiceError("NOT_FOUND", `No ${what} matches "${name}".`)
  throw new ServiceError(
    "VALIDATION",
    `Several ${what}s match "${name}": ${rows
      .slice(0, 8)
      .map((r) => r.name)
      .join(", ")}. Ask the user which one.`
  )
}

const GENERIC_WORDS = new Set([
  "expense",
  "expenses",
  "account",
  "accounts",
  "a/c",
  "the",
  "and",
  "of",
])

async function findAccount(ctx: OrgContext, name: string) {
  const page = await listLedgerAccounts(
    ctx,
    null,
    { search: name },
    { limit: 20 }
  )
  if (page.items.length > 0) return pickOne("account", name, page.items)
  // "Rent Expense" → "Rent": match on the specific words, best match wins;
  // a tie is ambiguous and the model asks. The approver sees the account.
  const words = name
    .toLowerCase()
    .split(/[\s,()/-]+/)
    .filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w))
  const pages = await Promise.all(
    words.map((w) =>
      listLedgerAccounts(ctx, null, { search: w }, { limit: 20 })
    )
  )
  const score = new Map<
    string,
    { row: (typeof page.items)[number]; n: number }
  >()
  // Whole words of the account name only ("current" is not "rent").
  for (const p of pages)
    for (const row of p.items) {
      const own = new Set(row.name.toLowerCase().split(/[\s,()/-]+/))
      const n = words.filter((w) => own.has(w)).length
      if (n > 0) score.set(row.id, { row, n })
    }
  const ranked = [...score.values()].sort((a, b) => b.n - a.n)
  const best = ranked.filter((r) => r.n === ranked[0]?.n).map((r) => r.row)
  return pickOne("account", name, best)
}

async function findCustomer(ctx: OrgContext, name: string) {
  const page = await listParties(ctx, null, { search: name }, { limit: 20 })
  return pickOne("customer", name, page.items)
}

async function insertProposal(
  ctx: OrgContext,
  conversationId: string | null,
  proposal: AskProposal,
  entry: ProposedEntry,
  gst: Parameters<typeof encodeGst>[0]
): Promise<string> {
  return withTransaction(async (tx) => {
    const id = crypto.randomUUID()
    await tx.insert(inboxItems).values({
      id,
      organizationId: ctx.orgId,
      kind: "ask_proposal",
      proposedEntry: encodeProposedEntry(entry),
      confidence: 1,
      reason: ASK_PROPOSAL_REASON,
      gst: encodeGst(gst),
      sourceType: "conversation",
      // One item per proposal; the conversation is in conversation_id.
      sourceId: crypto.randomUUID(),
      conversationId,
      proposal,
    })
    await tx.insert(auditLog).values({
      organizationId: ctx.orgId,
      actorId: ctx.userId,
      action: "inbox.propose",
      entity: "inbox_item",
      entityId: id,
      before: null,
      after: {
        note: `proposed by Ask Median (conversation ${conversationId ?? "unknown"})`,
        type: proposal.type,
        conversationId,
      },
      source: "ask_median",
    })
    return id
  })
}

export interface ProposeJournalInput {
  readonly narration: string
  readonly date: string
  readonly lines: readonly JournalLineInput[]
}

/** Sends a balanced journal to the inbox for approval. Posts nothing. */
export async function proposeJournal(
  ctx: OrgContext,
  input: ProposeJournalInput,
  conversationId: string | null
) {
  assertCan(ctx, "ledger", "propose")
  const totals = checkJournalLines(input.lines)
  const accounts = await Promise.all(
    input.lines.map((l) => findAccount(ctx, l.accountName))
  )
  const entry: ProposedEntry = {
    entryDate: input.date,
    narration: input.narration,
    lines: input.lines.map((l, n) => ({
      accountId: accounts[n]!.id,
      partyId: null,
      debit: paise(l.debitPaise ?? 0n),
      credit: paise(l.creditPaise ?? 0n),
      description: null,
    })),
  }
  const inboxItemId = await insertProposal(
    ctx,
    conversationId,
    { type: "journal" },
    entry,
    null
  )
  return {
    inboxItemId,
    status: "pending approval",
    narration: input.narration,
    date: input.date,
    lines: input.lines.map((l, n) => ({
      account: accounts[n]!.name,
      debit: paise(l.debitPaise ?? 0n),
      credit: paise(l.creditPaise ?? 0n),
    })),
    totalDebit: totals.debit,
    totalCredit: totals.credit,
  }
}

export interface ProposeInvoiceLine {
  readonly description: string
  readonly hsnSac: string
  readonly gstRateBps: (typeof GST_RATES_BPS)[number]
  /** Either a lump sum… */
  readonly amountPaise?: bigint | undefined
  /** …or a rate (paise) and quantity. */
  readonly ratePaise?: bigint | undefined
  readonly quantity?: string | undefined
}

export interface ProposeInvoiceInput {
  readonly customerName: string
  readonly date: string
  readonly lines: readonly ProposeInvoiceLine[]
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Sends an invoice to the inbox for approval. Taxable value, CGST/SGST or
 * IGST and the total come from the invoice service's GST code (previewInvoice),
 * never the model. Approval issues it through createInvoice's code.
 */
export async function proposeInvoice(
  ctx: OrgContext,
  input: ProposeInvoiceInput,
  conversationId: string | null
) {
  assertCan(ctx, "ledger", "propose")
  const [party, terms] = await Promise.all([
    findCustomer(ctx, input.customerName),
    getDefaultPaymentTerms(ctx),
  ])
  const lines = input.lines.map((l) => {
    const byRate = l.ratePaise !== undefined
    if (byRate === (l.amountPaise !== undefined))
      throw new ServiceError(
        "VALIDATION",
        `Line "${l.description}": give an amount, or a rate and quantity.`
      )
    return {
      description: l.description,
      hsnSac: l.hsnSac,
      quantity: byRate ? (l.quantity ?? "1") : "1",
      unitPrice: (byRate ? l.ratePaise : l.amountPaise) ?? 0n,
      gstRateBps: l.gstRateBps,
    }
  })
  const invoiceInput = {
    partyId: party.id,
    invoiceDate: input.date,
    dueDate: addDays(input.date, terms),
    lines,
  }
  const [preview, { entry, gst }] = await Promise.all([
    previewInvoice(ctx, invoiceInput),
    invoiceProposalEntry(ctx, invoiceInput, party.name),
  ])
  const inboxItemId = await insertProposal(
    ctx,
    conversationId,
    {
      type: "invoice",
      customerName: party.name,
      input: {
        ...invoiceInput,
        lines: lines.map((l) => ({ ...l, unitPrice: String(l.unitPrice) })),
      },
    },
    entry,
    gst
  )
  return {
    inboxItemId,
    status: "pending approval",
    ...summary(party.name, preview),
  }
}

function summary(customer: string, p: InvoicePreview) {
  return {
    customer,
    placeOfSupply: p.placeOfSupply,
    supplyType: p.supplyType,
    lines: p.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      taxable: l.taxable,
      gstRateBps: l.gstRateBps,
      cgst: l.cgst,
      sgst: l.sgst,
      igst: l.igst,
      total: l.total,
    })),
    taxable: p.taxable,
    cgst: p.cgst,
    sgst: p.sgst,
    igst: p.igst,
    roundOff: p.roundOff,
    total: p.total,
    warnings: p.warnings,
  }
}
