import "server-only"

import { paise } from "@workspace/ledger"
import { z } from "zod"

import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { ServiceError } from "./errors"
import type { ProposedEntry } from "./proposed-entry"
import {
  STUB_ACCOUNTS,
  STUB_PARTIES,
  daysAgo,
  timestampDaysAgo,
} from "./stub-data"
import {
  idSchema,
  isoDateSchema,
  moneySchema,
  pageOptionsSchema,
  parseInput,
} from "./types"
import type { IsoTimestamp, Page, PageOptions } from "./types"

export type InboxItemKind =
  "bill" | "bank_line" | "razorpay_record" | "settlement_gap"
export type InboxStatus = "pending" | "approved" | "rejected"

export interface InboxItem {
  readonly id: string
  readonly kind: InboxItemKind
  readonly status: InboxStatus
  /** 0–1. How sure the rule or AI is about `proposedEntry`. */
  readonly confidence: number
  /** Why this needs a human, in plain words. */
  readonly reason: string
  readonly sourceRef: {
    readonly type: "document" | "source_record"
    readonly id: string
  }
  readonly proposedEntry: ProposedEntry
  readonly reviewedBy: string | null
  readonly reviewedAt: IsoTimestamp | null
  readonly reviewNote: string | null
  /** Set once approved and posted. */
  readonly postedEntryId: string | null
  readonly createdAt: IsoTimestamp
}

const listInboxFiltersSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  kind: z
    .enum(["bill", "bank_line", "razorpay_record", "settlement_gap"])
    .optional(),
})
export type ListInboxFilters = z.input<typeof listInboxFiltersSchema>

/** Changes the reviewer made before approving. Omitted fields keep the proposal. */
export const inboxEditsSchema = z.object({
  entryDate: isoDateSchema.optional(),
  narration: z.string().trim().min(1).max(500).optional(),
  lines: z
    .array(
      z.object({
        accountId: idSchema,
        partyId: idSchema.nullable(),
        debit: moneySchema,
        credit: moneySchema,
        description: z.string().max(500).nullable(),
      })
    )
    .min(2)
    .optional(),
})
export type InboxEdits = z.input<typeof inboxEditsSchema>

export interface ApproveInboxItemResult {
  readonly item: InboxItem
  readonly entryId: string
}

const stubItems: readonly InboxItem[] = [
  {
    id: "00000000-0000-4000-8000-00000000c001",
    kind: "bill",
    status: "pending",
    confidence: 0.86,
    reason: "New vendor bill from AWS. Check the expense account.",
    sourceRef: { type: "document", id: "00000000-0000-4000-8000-00000000d001" },
    proposedEntry: {
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
    proposedEntry: {
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
    },
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    postedEntryId: null,
    createdAt: timestampDaysAgo(2),
  },
  {
    id: "00000000-0000-4000-8000-00000000c003",
    kind: "settlement_gap",
    status: "pending",
    confidence: 0.6,
    reason:
      "Razorpay settlement setl_Ok3fX is ₹412.00 less than its payments minus fees and refunds.",
    sourceRef: {
      type: "source_record",
      id: "00000000-0000-4000-8000-00000000b011",
    },
    proposedEntry: {
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
    },
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
 * Posts the proposed entry (with `edits` applied) through the ledger and marks
 * the item approved. Throws PERIOD_LOCKED / UNBALANCED / CONFLICT (already
 * reviewed). STUB.
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
        lines: e.lines ?? item.proposedEntry.lines,
      },
      reviewedBy: ctx.userId,
      reviewedAt: new Date().toISOString(),
      postedEntryId: entryId,
    },
  }
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
