import "server-only"

import {
  ServiceError,
  billExtractionSchema,
  billReviewSchema,
  gstinSchema,
  idSchema,
  parseInput,
} from "@workspace/contracts"
import type { BillReviewInput, InboxItem } from "@workspace/contracts"
import type { SystemAccountKey } from "@workspace/ledger"
import {
  aliasedTable,
  and,
  desc,
  eq,
  gt,
  inArray,
  notInArray,
  sql,
} from "drizzle-orm"

import { requireRealDataAllowed } from "../ai/models"
import { withTransaction } from "../db"
import type { Tx } from "../db"
import {
  documents,
  inboxItems,
  journalLines,
  ledgerAccounts,
  organizationSettings,
  parties,
} from "../db/schema"
import { buildBillProposal, printedRateBps } from "./bill-proposal"
import type { BillAccounts } from "./bill-proposal"
import { requireConsent } from "./consent"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { lookupHsnSacRate } from "./gst-rates"
import { encodeGst, inboxItemViews } from "./inbox"
import { insertParty } from "./parties"
import { encodeProposedEntry } from "./proposed-entry"

/**
 * Moved to @workspace/contracts; re-exported so imports from this file keep
 * working. Import it from "@workspace/contracts".
 */
export { billExtractionSchema }
export type { BillExtraction } from "@workspace/contracts"

const BILL_KEYS = {
  payables: "trade_payables",
  inputCgst: "gst_input_cgst",
  inputSgst: "gst_input_sgst",
  inputIgst: "gst_input_igst",
  roundOff: "round_off",
  suspense: "suspense",
} as const satisfies Record<string, SystemAccountKey>

async function billAccounts(tx: Tx, orgId: string) {
  const rows = await tx
    .select({ id: ledgerAccounts.id, key: ledgerAccounts.systemKey })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.organizationId, orgId),
        inArray(ledgerAccounts.systemKey, Object.values(BILL_KEYS))
      )
    )
  const byKey = new Map(rows.map((r) => [r.key, r.id]))
  const pick = (key: SystemAccountKey) => {
    const id = byKey.get(key)
    if (!id)
      throw new ServiceError(
        "VALIDATION",
        `Your chart of accounts is missing a system account (${key}).`
      )
    return id
  }
  return {
    payables: pick(BILL_KEYS.payables),
    inputCgst: pick(BILL_KEYS.inputCgst),
    inputSgst: pick(BILL_KEYS.inputSgst),
    inputIgst: pick(BILL_KEYS.inputIgst),
    roundOff: pick(BILL_KEYS.roundOff),
    suspense: pick(BILL_KEYS.suspense),
  }
}

/**
 * The vendor by GSTIN, adding them when the GSTIN is valid and new (a valid
 * GSTIN identifies a business; the party is master data, not the books).
 * Without one, an exact, unique name match. Null when nothing fits.
 */
async function resolveVendor(
  tx: Tx,
  ctx: OrgContext,
  vendor: { readonly name: string; readonly gstin: string | null }
): Promise<{ partyId: string | null; isNew: boolean }> {
  const gstin = gstinSchema.safeParse(vendor.gstin?.trim().toUpperCase())
  if (gstin.success) {
    const [found] = await tx
      .select({ id: parties.id })
      .from(parties)
      .where(
        and(
          eq(parties.organizationId, ctx.orgId),
          eq(parties.kind, "vendor"),
          eq(parties.gstin, gstin.data)
        )
      )
      .limit(1)
    if (found) return { partyId: found.id, isNew: false }
    const added = await insertParty(
      tx,
      { orgId: ctx.orgId, userId: ctx.userId, source: "bill_extraction" },
      {
        kind: "vendor",
        name: vendor.name.trim().slice(0, 200),
        gstin: gstin.data,
      }
    )
    return { partyId: added.id, isNew: true }
  }
  const byName = await tx
    .select({ id: parties.id })
    .from(parties)
    .where(
      and(
        eq(parties.organizationId, ctx.orgId),
        eq(parties.kind, "vendor"),
        sql`lower(${parties.name}) = lower(${vendor.name.trim()})`
      )
    )
    .limit(2)
  const [only] = byName
  return { partyId: byName.length === 1 && only ? only.id : null, isNew: false }
}

/**
 * The account this vendor's last bill was booked to: the largest debit,
 * other than tax and round-off, in the latest entry crediting their payable.
 */
async function usualExpenseAccount(
  tx: Tx,
  orgId: string,
  partyId: string,
  accounts: Awaited<ReturnType<typeof billAccounts>>
): Promise<string | null> {
  const other = aliasedTable(journalLines, "other")
  const [row] = await tx
    .select({ accountId: other.accountId })
    .from(journalLines)
    .innerJoin(
      other,
      and(
        eq(other.organizationId, journalLines.organizationId),
        eq(other.entryId, journalLines.entryId)
      )
    )
    .where(
      and(
        eq(journalLines.organizationId, orgId),
        eq(journalLines.partyId, partyId),
        eq(journalLines.accountId, accounts.payables),
        gt(journalLines.creditPaise, 0n),
        gt(other.debitPaise, 0n),
        notInArray(other.accountId, [
          accounts.inputCgst,
          accounts.inputSgst,
          accounts.inputIgst,
          accounts.roundOff,
          accounts.suspense,
        ])
      )
    )
    .orderBy(
      desc(journalLines.entryDate),
      desc(journalLines.createdAt),
      desc(other.debitPaise)
    )
    .limit(1)
  return row?.accountId ?? null
}

/**
 * Turns a validated bill extraction into a pending purchase entry with
 * input tax credit, in the approval inbox; nothing is posted. The AI's
 * output is only read: amounts are parsed and tax and totals recomputed in
 * code, printed figures only cross-checked (rule 13). The vendor is matched
 * by GSTIN (added if new and valid), the expense account taken from their
 * last bill (else Suspense, flagged), and CGST+SGST vs IGST from the
 * vendor's state and the place of supply. `review` carries the AI module's
 * flags; Median adds its own. The document is marked extracted.
 * Throws VALIDATION (schema, non-INR, unreadable amount, not a bill),
 * NOT_FOUND (document), CONFLICT (already in the inbox), CONSENT_REQUIRED,
 * PAID_AI_REQUIRED.
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
  const ai = parseInput(billReviewSchema, review)
  await requireConsent(ctx)
  requireRealDataAllowed()

  // HSN/SAC master rates for lines that don't print one (outside the tx).
  const masterRates = new Map<number, number>()
  await Promise.all(
    bill.lines.map(async (line, i) => {
      const hsn = line.hsnSac?.trim()
      if (
        printedRateBps(line.gstRatePercent) !== null ||
        !hsn ||
        !/^\d{4,8}$/.test(hsn)
      )
        return
      const found = await lookupHsnSacRate(ctx, {
        code: hsn,
        onDate: bill.billDate,
      }).catch(() => null)
      if (found?.status === "found") masterRates.set(i, found.rate.rateBps)
    })
  )

  const itemId = await withTransaction(async (tx) => {
    const [doc] = await tx
      .select({ kind: documents.kind })
      .from(documents)
      .where(
        and(eq(documents.organizationId, ctx.orgId), eq(documents.id, docId))
      )
      .for("update")
    if (!doc) throw new ServiceError("NOT_FOUND", "Document not found.")
    if (doc.kind !== "bill")
      throw new ServiceError("VALIDATION", "That document isn't a bill.")

    const [[settings], accounts] = await Promise.all([
      tx
        .select({
          stateCode: organizationSettings.stateCode,
          gstRegistered: organizationSettings.gstRegistered,
          compositionScheme: organizationSettings.compositionScheme,
        })
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, ctx.orgId))
        .limit(1),
      billAccounts(tx, ctx.orgId),
    ])
    const vendor = await resolveVendor(tx, ctx, bill.vendor)
    const usual =
      vendor.partyId && !vendor.isNew
        ? await usualExpenseAccount(tx, ctx.orgId, vendor.partyId, accounts)
        : null
    const narration = `${bill.vendor.name} bill ${bill.billNumber}`.slice(
      0,
      500
    )
    const [duplicate] = await tx
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.organizationId, ctx.orgId),
          eq(inboxItems.kind, "bill"),
          inArray(inboxItems.status, ["pending", "approved"]),
          sql`${inboxItems.proposedEntry} ->> 'narration' = ${narration}`
        )
      )
      .limit(1)

    const billAccountsForProposal: BillAccounts = {
      ...accounts,
      expense: usual ?? accounts.suspense,
      expenseKnown: usual !== null,
    }
    const proposal = buildBillProposal(bill, ai.needsReview, {
      org: {
        stateCode: settings?.stateCode ?? null,
        claimsItc: Boolean(
          settings?.gstRegistered && !settings.compositionScheme
        ),
      },
      accounts: billAccountsForProposal,
      vendor,
      masterRates,
      duplicate: duplicate !== undefined,
    })
    const reviewFlags = {
      needsReview: [
        ...ai.needsReview,
        ...proposal.flags.filter((f) => f.kind === "needs_review"),
      ],
      notPrinted: [
        ...ai.notPrinted,
        ...proposal.flags.filter((f) => f.kind === "not_printed"),
      ],
    }
    const [item] = await tx
      .insert(inboxItems)
      .values({
        organizationId: ctx.orgId,
        kind: "bill",
        proposedEntry: encodeProposedEntry(proposal.entry),
        confidence: proposal.confidence,
        reason: proposal.reason,
        gst: encodeGst(proposal.gst),
        reviewFlags,
        sourceType: "document",
        sourceId: docId,
      })
      .onConflictDoNothing()
      .returning({ id: inboxItems.id })
    if (!item)
      throw new ServiceError("CONFLICT", "This bill is already in the inbox.")
    await tx
      .update(documents)
      .set({ status: "extracted", extracted: bill, updatedAt: new Date() })
      .where(
        and(eq(documents.organizationId, ctx.orgId), eq(documents.id, docId))
      )
    return item.id
  })
  const [view] = await inboxItemViews(ctx.orgId, [itemId])
  if (!view) throw new Error("unreachable: inbox item just created")
  return view
}
