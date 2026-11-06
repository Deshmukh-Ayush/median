import "server-only"

import {
  BULK_APPROVE_MAX,
  ServiceError,
  TDS_SECTIONS,
  bulkApproveInboxItemsInputSchema,
  idSchema,
  inboxEditsSchema,
  listInboxFiltersSchema,
  moneyJsonSchema,
  pageOptionsSchema,
  parseInput,
  proposedEntryJsonSchema,
} from "@workspace/contracts"
import type {
  ApproveInboxItemResult,
  BulkApproveResult,
  InboxEdits,
  InboxGstSplit,
  InboxItem,
  InboxTds,
  LedgerAccountSummary,
  ListInboxFilters,
  Page,
  PageOptions,
  PartyRef,
  ProposedEntry,
} from "@workspace/contracts"
import { and, desc, eq, inArray, lt, or } from "drizzle-orm"
import { z } from "zod"

import { getDb, withTransaction } from "../db"
import type { Tx } from "../db"
import {
  inboxItems,
  ledgerAccounts,
  parties,
  sourceRecords,
} from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { applyInboxEdits } from "./inbox-edits"
import type { TaxAccounts } from "./inbox-edits"
import { postEntry } from "./ledger"
import { decodeCursor, encodeCursor } from "./pagination"
import { encodeProposedEntry, toProposedEntryView } from "./proposed-entry"

// The approval inbox: everything a rule or the AI couldn't post with high
// confidence waits here. Approving posts through postEntry (rules 1–4);
// nothing reaches the ledger without it.

const noFlags = { needsReview: [], notPrinted: [] }

const gstJsonSchema = z
  .object({
    taxable: moneyJsonSchema,
    cgst: moneyJsonSchema,
    sgst: moneyJsonSchema,
    igst: moneyJsonSchema,
    rateBps: z.int().nullable(),
    supplyType: z.enum(["intrastate", "interstate"]).nullable(),
  })
  .nullable()
const tdsJsonSchema = z
  .object({
    section: z.enum(TDS_SECTIONS),
    rateBps: z.int(),
    amount: moneyJsonSchema,
  })
  .nullable()

const itemColumns = {
  id: inboxItems.id,
  kind: inboxItems.kind,
  status: inboxItems.status,
  confidence: inboxItems.confidence,
  reason: inboxItems.reason,
  sourceType: inboxItems.sourceType,
  sourceId: inboxItems.sourceId,
  proposedEntry: inboxItems.proposedEntry,
  gst: inboxItems.gst,
  tds: inboxItems.tds,
  reviewedBy: inboxItems.reviewedBy,
  reviewedAt: inboxItems.reviewedAt,
  reviewNote: inboxItems.reviewNote,
  postedEntryId: inboxItems.postedEntryId,
  createdAt: inboxItems.createdAt,
}

interface ItemRow {
  readonly id: string
  readonly kind: InboxItem["kind"]
  readonly status: InboxItem["status"]
  readonly confidence: number
  readonly reason: string
  readonly sourceType: "document" | "source_record"
  readonly sourceId: string
  readonly proposedEntry: unknown
  readonly gst: unknown
  readonly tds: unknown
  readonly reviewedBy: string | null
  readonly reviewedAt: Date | null
  readonly reviewNote: string | null
  readonly postedEntryId: string | null
  readonly createdAt: Date
}

interface DecodedItem {
  readonly row: ItemRow
  readonly entry: ProposedEntry
  readonly gst: InboxGstSplit | null
  readonly tds: InboxTds | null
}

function decode(row: ItemRow): DecodedItem {
  const entry = proposedEntryJsonSchema.safeParse(row.proposedEntry)
  if (!entry.success)
    throw new Error(`inbox_items ${row.id}: stored proposal is invalid`)
  return {
    row,
    entry: entry.data,
    gst: gstJsonSchema.catch(null).parse(row.gst ?? null),
    tds: tdsJsonSchema.catch(null).parse(row.tds ?? null),
  }
}

function encodeGst(g: InboxGstSplit | null): unknown {
  return (
    g && {
      ...g,
      taxable: String(g.taxable),
      cgst: String(g.cgst),
      sgst: String(g.sgst),
      igst: String(g.igst),
    }
  )
}
const encodeTds = (t: InboxTds | null): unknown =>
  t && { ...t, amount: String(t.amount) }

/** Account and party names for a set of items: two queries, no N+1. */
async function viewsFor(
  orgId: string,
  items: readonly DecodedItem[]
): Promise<InboxItem[]> {
  const accountIds = [
    ...new Set(items.flatMap((i) => i.entry.lines.map((l) => l.accountId))),
  ]
  const partyIds = [
    ...new Set(
      items.flatMap((i) =>
        i.entry.lines.flatMap((l) => (l.partyId ? [l.partyId] : []))
      )
    ),
  ]
  const db = getDb()
  const [accountRows, partyRows] = await Promise.all([
    accountIds.length === 0
      ? []
      : db
          .select({
            id: ledgerAccounts.id,
            code: ledgerAccounts.code,
            name: ledgerAccounts.name,
            type: ledgerAccounts.type,
            parentId: ledgerAccounts.parentId,
            isSystem: ledgerAccounts.isSystem,
            isBank: ledgerAccounts.isBank,
          })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.organizationId, orgId),
              inArray(ledgerAccounts.id, accountIds)
            )
          ),
    partyIds.length === 0
      ? []
      : db
          .select({ id: parties.id, name: parties.name, gstin: parties.gstin })
          .from(parties)
          .where(
            and(
              eq(parties.organizationId, orgId),
              inArray(parties.id, partyIds)
            )
          ),
  ])
  const accounts = new Map<string, LedgerAccountSummary>(
    accountRows.map((a) => [a.id, a])
  )
  const partyMap = new Map<string, PartyRef>(partyRows.map((p) => [p.id, p]))
  return items.map(({ row, entry, gst, tds }) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    confidence: row.confidence,
    reason: row.reason,
    sourceRef: { type: row.sourceType, id: row.sourceId },
    // Signed document URLs come with bill uploads (Day 4).
    sourceDocumentUrl: null,
    proposedEntry: toProposedEntryView(entry, accounts, partyMap),
    gst,
    tds,
    reviewFlags: noFlags,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    reviewNote: row.reviewNote,
    postedEntryId: row.postedEntryId,
    createdAt: row.createdAt.toISOString(),
  }))
}

/** Newest first. Defaults to pending items. */
export async function listInboxItems(
  ctx: OrgContext,
  cursor: string | null,
  filters: ListInboxFilters = {},
  options: PageOptions = {}
): Promise<Page<InboxItem>> {
  assertCan(ctx, "ledger", "read")
  const f = parseInput(listInboxFiltersSchema, filters)
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = decodeCursor(cursor)
  const afterAt = after ? new Date(after.k) : null
  if (afterAt && Number.isNaN(afterAt.getTime()))
    throw new ServiceError("VALIDATION", "Invalid page cursor.")

  const rows = await getDb()
    .select(itemColumns)
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.organizationId, ctx.orgId),
        eq(inboxItems.status, f.status),
        f.kind ? eq(inboxItems.kind, f.kind) : undefined,
        after && afterAt
          ? or(
              lt(inboxItems.createdAt, afterAt),
              and(
                eq(inboxItems.createdAt, afterAt),
                lt(inboxItems.id, after.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(inboxItems.createdAt), desc(inboxItems.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    items: await viewsFor(ctx.orgId, page.map(decode)),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
        : null,
  }
}

const TAX_KEYS = {
  outputCgst: "gst_output_cgst",
  outputSgst: "gst_output_sgst",
  outputIgst: "gst_output_igst",
  inputCgst: "gst_input_cgst",
  inputSgst: "gst_input_sgst",
  inputIgst: "gst_input_igst",
  tdsReceivable: "tds_receivable",
  receivables: "trade_receivables",
} as const

async function taxAccounts(tx: Tx, orgId: string): Promise<TaxAccounts> {
  const rows = await tx
    .select({ id: ledgerAccounts.id, key: ledgerAccounts.systemKey })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.organizationId, orgId),
        inArray(ledgerAccounts.systemKey, Object.values(TAX_KEYS))
      )
    )
  const byKey = new Map(rows.map((r) => [r.key, r.id]))
  const pick = (key: string) => byKey.get(key) ?? ""
  return {
    outputCgst: pick(TAX_KEYS.outputCgst),
    outputSgst: pick(TAX_KEYS.outputSgst),
    outputIgst: pick(TAX_KEYS.outputIgst),
    inputCgst: pick(TAX_KEYS.inputCgst),
    inputSgst: pick(TAX_KEYS.inputSgst),
    inputIgst: pick(TAX_KEYS.inputIgst),
    tdsReceivable: pick(TAX_KEYS.tdsReceivable),
    receivables: pick(TAX_KEYS.receivables),
  }
}

async function lockPending(
  tx: Tx,
  orgId: string,
  id: string
): Promise<DecodedItem> {
  const [row] = await tx
    .select(itemColumns)
    .from(inboxItems)
    .where(and(eq(inboxItems.organizationId, orgId), eq(inboxItems.id, id)))
    .for("update")
  if (!row) throw new ServiceError("NOT_FOUND", "Inbox item not found.")
  if (row.status !== "pending")
    throw new ServiceError(
      "CONFLICT",
      `Someone already ${row.status === "approved" ? "approved" : "rejected"} this item.`
    )
  return decode(row)
}

/**
 * Posts the proposed entry (with `edits` applied; GST and TDS edits rebuild
 * the tax lines in code) through the ledger and marks the item approved, in
 * one transaction. Throws NOT_FOUND, VALIDATION, PERIOD_LOCKED, UNBALANCED,
 * CONFLICT (already reviewed).
 */
export async function approveInboxItem(
  ctx: OrgContext,
  id: string,
  edits?: InboxEdits
): Promise<ApproveInboxItemResult> {
  assertCan(ctx, "ledger", "post")
  const itemId = parseInput(idSchema, id)
  const e = parseInput(inboxEditsSchema, edits ?? {})
  const { decoded, entryId } = await withTransaction(async (tx) => {
    const item = await lockPending(tx, ctx.orgId, itemId)
    const edited = applyInboxEdits(
      item.entry,
      { gst: item.gst, tds: item.tds },
      e,
      await taxAccounts(tx, ctx.orgId)
    )
    const posted = await postEntry(
      { orgId: ctx.orgId, userId: ctx.userId, source: "inbox" },
      {
        entryDate: edited.entry.entryDate,
        narration: edited.entry.narration,
        sourceType: "inbox",
        sourceId: item.row.id,
        lines: edited.entry.lines.map((l) => ({ ...l })),
      },
      { tx }
    ).catch((error: unknown) => {
      if (error instanceof ServiceError && error.code === "UNBALANCED")
        throw new ServiceError(
          "UNBALANCED",
          e.gst || e.tds !== undefined || e.lines
            ? "These edits don't balance. Check the amounts."
            : "This entry doesn't balance. Check the amounts.",
          error.details
        )
      throw error
    })
    const [row] = await tx
      .update(inboxItems)
      .set({
        status: "approved",
        reviewedBy: ctx.userId,
        reviewedAt: new Date(),
        postedEntryId: posted.id,
        proposedEntry: encodeProposedEntry(edited.entry),
        gst: encodeGst(edited.gst),
        tds: encodeTds(edited.tds),
      })
      .where(
        and(eq(inboxItems.organizationId, ctx.orgId), eq(inboxItems.id, itemId))
      )
      .returning(itemColumns)
    if (!row) throw new ServiceError("CONFLICT", "Inbox item changed.")
    if (item.row.sourceType === "source_record") {
      await tx
        .update(sourceRecords)
        .set({ status: "posted", journalEntryId: posted.id })
        .where(
          and(
            eq(sourceRecords.organizationId, ctx.orgId),
            eq(sourceRecords.id, item.row.sourceId),
            eq(sourceRecords.status, "inbox")
          )
        )
    }
    return { decoded: decode(row), entryId: posted.id }
  })
  const [item] = await viewsFor(ctx.orgId, [decoded])
  if (!item) throw new Error("unreachable")
  return { item, entryId }
}

/**
 * Approves up to BULK_APPROVE_MAX items without edits, each in its own
 * transaction: one failure (e.g. PERIOD_LOCKED) doesn't stop the rest.
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

/**
 * Marks the item rejected with the reviewer's reason; its source record is
 * set aside (not booked). Throws NOT_FOUND, CONFLICT (already reviewed).
 */
export async function rejectInboxItem(
  ctx: OrgContext,
  id: string,
  reason: string
): Promise<InboxItem> {
  assertCan(ctx, "ledger", "propose")
  const itemId = parseInput(idSchema, id)
  const note = parseInput(z.string().trim().min(1).max(500), reason)
  const decoded = await withTransaction(async (tx) => {
    const item = await lockPending(tx, ctx.orgId, itemId)
    const [row] = await tx
      .update(inboxItems)
      .set({
        status: "rejected",
        reviewedBy: ctx.userId,
        reviewedAt: new Date(),
        reviewNote: note,
      })
      .where(
        and(eq(inboxItems.organizationId, ctx.orgId), eq(inboxItems.id, itemId))
      )
      .returning(itemColumns)
    if (!row) throw new ServiceError("CONFLICT", "Inbox item changed.")
    if (item.row.sourceType === "source_record") {
      await tx
        .update(sourceRecords)
        .set({ status: "ignored" })
        .where(
          and(
            eq(sourceRecords.organizationId, ctx.orgId),
            eq(sourceRecords.id, item.row.sourceId),
            eq(sourceRecords.status, "inbox")
          )
        )
    }
    return decode(row)
  })
  const [item] = await viewsFor(ctx.orgId, [decoded])
  if (!item) throw new Error("unreachable")
  return item
}
