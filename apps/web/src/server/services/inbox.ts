import "server-only"

import {
  BULK_APPROVE_MAX,
  ServiceError,
  bulkApproveInboxItemsInputSchema,
  idSchema,
  inboxEditsSchema,
  listInboxFiltersSchema,
  pageOptionsSchema,
  parseInput,
} from "@workspace/contracts"
import type {
  ApproveInboxItemResult,
  BulkApproveResult,
  InboxEdits,
  InboxItem,
  ListInboxFilters,
  Page,
  PageOptions,
  PartyRef,
  ProposedEntry,
} from "@workspace/contracts"
import { paise } from "@workspace/ledger"
import { z } from "zod"

import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { toProposedEntryView } from "./proposed-entry"
import {
  STUB_ACCOUNTS,
  STUB_ACCOUNT_LIST,
  STUB_PARTIES,
  daysAgo,
  timestampDaysAgo,
} from "./stub-data"

const stubAccounts = new Map(STUB_ACCOUNT_LIST.map((a) => [a.id, a]))
const stubParties = new Map<string, PartyRef>(
  Object.values(STUB_PARTIES).map((p) => [p.id, p])
)
const view = (entry: ProposedEntry) =>
  toProposedEntryView(entry, stubAccounts, stubParties)

const noFlags = { needsReview: [], notPrinted: [] }

const stubItems: readonly InboxItem[] = [
  {
    id: "00000000-0000-4000-8000-00000000c001",
    kind: "bill",
    status: "pending",
    confidence: 0.86,
    reason: "New vendor bill from AWS. Check the expense account.",
    sourceRef: { type: "document", id: "00000000-0000-4000-8000-00000000d001" },
    sourceDocumentUrl:
      "https://example.blob.vercel-storage.com/bills/aws-in-2026-118734.pdf",
    proposedEntry: view({
      entryDate: daysAgo(4),
      narration: "AWS invoice IN-2026-118734 (October hosting)",
      lines: [
        {
          accountId: STUB_ACCOUNTS.hosting.id,
          partyId: null,
          debit: paise(42_000_00n),
          credit: paise(0n),
          description: "EC2 + RDS",
        },
        {
          accountId: STUB_ACCOUNTS.inputCgst.id,
          partyId: null,
          debit: paise(3_780_00n),
          credit: paise(0n),
          description: "CGST 9%",
        },
        {
          accountId: STUB_ACCOUNTS.inputSgst.id,
          partyId: null,
          debit: paise(3_780_00n),
          credit: paise(0n),
          description: "SGST 9%",
        },
        {
          accountId: STUB_ACCOUNTS.payables.id,
          partyId: STUB_PARTIES.aws.id,
          debit: paise(0n),
          credit: paise(49_560_00n),
          description: null,
        },
      ],
    }),
    gst: {
      taxable: paise(42_000_00n),
      cgst: paise(3_780_00n),
      sgst: paise(3_780_00n),
      igst: paise(0n),
      rateBps: 1800,
      supplyType: "intrastate",
    },
    tds: null,
    reviewFlags: {
      needsReview: [
        {
          field: "lines[0].hsnSac",
          kind: "needs_review",
          reason: "Partly cut off",
          source: "model",
        },
      ],
      notPrinted: [
        {
          field: "dueDate",
          kind: "not_printed",
          reason: "No due date on the bill",
          source: "check",
        },
      ],
    },
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    postedEntryId: null,
    createdAt: timestampDaysAgo(1),
  },
  {
    id: "00000000-0000-4000-8000-00000000c002",
    kind: "bank_line",
    status: "pending",
    confidence: 0.42,
    reason:
      'Bank debit of ₹1,85,000.00 with reference "NEFT-SAL-OCT" didn\'t match any bill or vendor.',
    sourceRef: {
      type: "source_record",
      id: "00000000-0000-4000-8000-00000000b010",
    },
    sourceDocumentUrl: null,
    proposedEntry: view({
      entryDate: daysAgo(5),
      narration: "NEFT-SAL-OCT",
      lines: [
        {
          accountId: STUB_ACCOUNTS.salaries.id,
          partyId: null,
          debit: paise(1_85_000_00n),
          credit: paise(0n),
          description: null,
        },
        {
          accountId: STUB_ACCOUNTS.bank.id,
          partyId: null,
          debit: paise(0n),
          credit: paise(1_85_000_00n),
          description: null,
        },
      ],
    }),
    gst: null,
    tds: null,
    reviewFlags: noFlags,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    postedEntryId: null,
    createdAt: timestampDaysAgo(2),
  },
  {
    id: "00000000-0000-4000-8000-00000000c003",
    kind: "bank_line",
    status: "pending",
    confidence: 0.74,
    reason:
      "₹1,16,000.00 from Acme Retail is ₹2,000.00 short of invoice INV/2026-27/0042: looks like 2% TDS under 194J.",
    sourceRef: {
      type: "source_record",
      id: "00000000-0000-4000-8000-00000000b012",
    },
    sourceDocumentUrl: null,
    proposedEntry: view({
      entryDate: daysAgo(1),
      narration: "Receipt from Acme Retail against INV/2026-27/0042 (TDS 194J)",
      lines: [
        {
          accountId: STUB_ACCOUNTS.bank.id,
          partyId: null,
          debit: paise(1_16_000_00n),
          credit: paise(0n),
          description: null,
        },
        {
          accountId: STUB_ACCOUNTS.tdsReceivable.id,
          partyId: STUB_PARTIES.acme.id,
          debit: paise(2_000_00n),
          credit: paise(0n),
          description: "TDS 194J @ 2%",
        },
        {
          accountId: STUB_ACCOUNTS.receivables.id,
          partyId: STUB_PARTIES.acme.id,
          debit: paise(0n),
          credit: paise(1_18_000_00n),
          description: null,
        },
      ],
    }),
    gst: null,
    tds: { section: "194J", rateBps: 200, amount: paise(2_000_00n) },
    reviewFlags: noFlags,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    postedEntryId: null,
    createdAt: timestampDaysAgo(1),
  },
  {
    id: "00000000-0000-4000-8000-00000000c004",
    kind: "settlement_gap",
    status: "pending",
    confidence: 0.6,
    reason:
      "Razorpay settlement setl_Ok3fX is ₹412.00 less than its payments minus fees and refunds.",
    sourceRef: {
      type: "source_record",
      id: "00000000-0000-4000-8000-00000000b011",
    },
    sourceDocumentUrl: null,
    proposedEntry: view({
      entryDate: daysAgo(6),
      narration: "Unexplained settlement difference setl_Ok3fX",
      lines: [
        {
          accountId: STUB_ACCOUNTS.gatewayCharges.id,
          partyId: null,
          debit: paise(412_00n),
          credit: paise(0n),
          description: null,
        },
        {
          accountId: STUB_ACCOUNTS.razorpayClearing.id,
          partyId: null,
          debit: paise(0n),
          credit: paise(412_00n),
          description: null,
        },
      ],
    }),
    gst: null,
    tds: null,
    reviewFlags: noFlags,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    postedEntryId: null,
    createdAt: timestampDaysAgo(3),
  },
]

function findStub(id: string): InboxItem {
  const item = stubItems.find((i) => i.id === id)
  if (!item) throw new ServiceError("NOT_FOUND", "Inbox item not found.")
  return item
}

/** Newest first. Defaults to pending items. STUB. */
export async function listInboxItems(
  ctx: OrgContext,
  cursor: string | null,
  filters: ListInboxFilters = {},
  options: PageOptions = {}
): Promise<Page<InboxItem>> {
  assertCan(ctx, "ledger", "read")
  const f = parseInput(listInboxFiltersSchema, filters)
  const { limit } = parseInput(pageOptionsSchema, options)
  const items = stubItems.filter(
    (i) => i.status === f.status && (!f.kind || i.kind === f.kind)
  )
  await Promise.resolve()
  return { items: cursor ? [] : items.slice(0, limit), nextCursor: null }
}

/**
 * Posts the proposed entry (with `edits` applied; GST and TDS edits rebuild
 * the tax lines in code) through the ledger and marks the item approved.
 * Throws PERIOD_LOCKED / UNBALANCED / CONFLICT (already reviewed). STUB.
 */
export async function approveInboxItem(
  ctx: OrgContext,
  id: string,
  edits?: InboxEdits
): Promise<ApproveInboxItemResult> {
  assertCan(ctx, "ledger", "post")
  const itemId = parseInput(idSchema, id)
  const e = parseInput(inboxEditsSchema, edits ?? {})
  const item = findStub(itemId)
  const entryId = crypto.randomUUID()
  await Promise.resolve()
  return {
    entryId,
    item: {
      ...item,
      status: "approved",
      proposedEntry: {
        entryDate: e.entryDate ?? item.proposedEntry.entryDate,
        narration: e.narration ?? item.proposedEntry.narration,
        lines: e.lines
          ? view({ ...item.proposedEntry, lines: e.lines }).lines
          : item.proposedEntry.lines,
      },
      gst: e.gst && item.gst ? { ...item.gst, ...e.gst } : item.gst,
      tds: e.tds === undefined ? item.tds : e.tds,
      reviewedBy: ctx.userId,
      reviewedAt: new Date().toISOString(),
      postedEntryId: entryId,
    },
  }
}

/**
 * Approves up to BULK_APPROVE_MAX items without edits, each in its own
 * transaction: one failure (e.g. PERIOD_LOCKED) doesn't stop the rest. STUB.
 */
export async function bulkApproveInboxItems(
  ctx: OrgContext,
  ids: readonly string[]
): Promise<BulkApproveResult> {
  assertCan(ctx, "ledger", "post")
  const itemIds = parseInput(bulkApproveInboxItemsInputSchema, ids)
  const approved: { id: string; entryId: string }[] = []
  const failed: { id: string; code: string; message: string }[] = []
  for (const id of itemIds.slice(0, BULK_APPROVE_MAX)) {
    try {
      const result = await approveInboxItem(ctx, id)
      approved.push({ id, entryId: result.entryId })
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error
      failed.push({ id, code: error.code, message: error.message })
    }
  }
  return { approved, failed }
}

/** Marks the item rejected with the reviewer's reason. STUB. */
export async function rejectInboxItem(
  ctx: OrgContext,
  id: string,
  reason: string
): Promise<InboxItem> {
  assertCan(ctx, "ledger", "propose")
  const itemId = parseInput(idSchema, id)
  const note = parseInput(z.string().trim().min(1).max(500), reason)
  const item = findStub(itemId)
  await Promise.resolve()
  return {
    ...item,
    status: "rejected",
    reviewedBy: ctx.userId,
    reviewedAt: new Date().toISOString(),
    reviewNote: note,
  }
}
