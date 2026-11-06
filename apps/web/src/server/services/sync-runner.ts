import "server-only"

import { ServiceError, sourceRecordSchema } from "@workspace/contracts"
import type {
  ConnectionStatus,
  InboxGstSplit,
  InboxTds,
  SourceRecord,
  SourceRecordInput,
  SourceRecordKind,
} from "@workspace/contracts"
import { paise, resolveGstRate } from "@workspace/ledger"
import type { EffectiveRate, SystemAccountKey } from "@workspace/ledger"
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"

import { getDb, withTransaction } from "../db"
import {
  connections,
  gstRateMappings,
  inboxItems,
  invoices,
  journalLines,
  ledgerAccounts,
  organizationDefaultGstRates,
  organizationSettings,
  sourceRecords,
} from "../db/schema"
import type { ConnectorCursor, SettlementLink } from "../integrations/connector"
import {
  ConnectorAuthError,
  ConnectorError,
  isFileConnector,
} from "../integrations/connector"
import { decryptCredentials } from "../integrations/credentials"
import { getConnector } from "../integrations/registry"
import { postEntry } from "./ledger"
import {
  feeRule,
  istDateOf,
  paymentInvoiceNumber,
  paymentMappingKey,
  paymentRule,
  refundRule,
  settlementRule,
} from "./posting-rules"
import type {
  Decision,
  OpenInvoice,
  OriginalPayment,
  RuleAccounts,
  RuleOrg,
  RuleRecord,
  SettlementTotals,
} from "./posting-rules"
import { encodeProposedEntry } from "./proposed-entry"

// Sync runner: stores connector records idempotently, saves the cursor and
// connection status, then runs the posting rules on every record not yet
// booked. Shared by syncConnection (API connectors), importFile (file
// connectors) and the scheduled sync.

/** A sync still marked "syncing" after this long is treated as crashed. */
const STALE_SYNC_MS = 15 * 60_000
const INSERT_CHUNK = 200
/** Records the posting rules look at per run; the rest wait for the next. */
const POST_BATCH = 5_000

export interface StoreResult {
  readonly fetched: Partial<Record<SourceRecordKind, number>>
  readonly inserted: number
  readonly skippedExisting: number
  readonly errors: readonly {
    readonly index: number
    readonly message: string
  }[]
}

export interface PostResult {
  readonly posted: number
  readonly sentToInbox: number
  /** Posting failures (e.g. locked period); those records went to the inbox. */
  readonly postingErrors: readonly {
    readonly recordId: string
    readonly message: string
  }[]
}

// ---------------------------------------------------------------------------
// Storing records

/** Upserts records: new ones are inserted; unbooked ones get fresh payloads. */
export async function storeRecords(
  orgId: string,
  connectionId: string,
  inputs: readonly SourceRecordInput[]
): Promise<StoreResult> {
  const fetched: Partial<Record<SourceRecordKind, number>> = {}
  const errors: { index: number; message: string }[] = []
  const valid: SourceRecord[] = []
  inputs.forEach((input, index) => {
    const parsed = sourceRecordSchema.safeParse(input)
    if (!parsed.success) {
      errors.push({
        index,
        message: parsed.error.issues[0]?.message ?? "Invalid record",
      })
      return
    }
    valid.push(parsed.data)
    fetched[parsed.data.kind] = (fetched[parsed.data.kind] ?? 0) + 1
  })

  const db = getDb()
  let inserted = 0
  const toRow = (r: SourceRecord) => ({
    organizationId: orgId,
    connectionId,
    provider: r.provider,
    externalId: r.externalId,
    dedupeHash: r.externalId === null ? r.dedupeHash : null,
    kind: r.kind,
    currency: r.currency,
    direction: r.direction,
    amountPaise: r.amountPaise,
    occurredAt: new Date(r.occurredAt),
    reference: r.reference,
    settlementExternalId: r.settlementExternalId,
    payload: r.payload,
  })
  const withId = valid.filter((r) => r.externalId !== null)
  const hashed = valid.filter((r) => r.externalId === null)

  for (let i = 0; i < withId.length; i += INSERT_CHUNK) {
    const rows = await db
      .insert(sourceRecords)
      .values(withId.slice(i, i + INSERT_CHUNK).map(toRow))
      .onConflictDoUpdate({
        target: [
          sourceRecords.organizationId,
          sourceRecords.provider,
          sourceRecords.externalId,
        ],
        // Records not booked yet take the provider's latest state (a refund
        // turning processed); booked ones never change.
        set: {
          payload: sql`excluded.payload`,
          amountPaise: sql`excluded.amount_paise`,
          settlementExternalId: sql`coalesce(${sourceRecords.settlementExternalId}, excluded.settlement_external_id)`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${sourceRecords.status} = 'new'`,
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` })
    inserted += rows.filter((r) => r.inserted).length
  }
  for (let i = 0; i < hashed.length; i += INSERT_CHUNK) {
    const rows = await db
      .insert(sourceRecords)
      .values(hashed.slice(i, i + INSERT_CHUNK).map(toRow))
      .onConflictDoNothing({
        target: [sourceRecords.organizationId, sourceRecords.dedupeHash],
        where: sql`${sourceRecords.dedupeHash} is not null`,
      })
      .returning({ id: sourceRecords.id })
    inserted += rows.length
  }
  return { fetched, inserted, skippedExisting: valid.length - inserted, errors }
}

/** Ties stored records to their settlement (recon), where not yet linked. */
export async function applySettlementLinks(
  orgId: string,
  provider: string,
  links: readonly SettlementLink[]
): Promise<void> {
  const bySettlement = new Map<string, string[]>()
  for (const l of links) {
    const ids = bySettlement.get(l.settlementExternalId) ?? []
    ids.push(l.externalId)
    bySettlement.set(l.settlementExternalId, ids)
  }
  const db = getDb()
  for (const [settlementId, externalIds] of bySettlement) {
    for (let i = 0; i < externalIds.length; i += INSERT_CHUNK) {
      await db
        .update(sourceRecords)
        .set({ settlementExternalId: settlementId })
        .where(
          and(
            eq(sourceRecords.organizationId, orgId),
            eq(sourceRecords.provider, provider),
            inArray(
              sourceRecords.externalId,
              externalIds.slice(i, i + INSERT_CHUNK)
            ),
            isNull(sourceRecords.settlementExternalId)
          )
        )
    }
  }
}

// ---------------------------------------------------------------------------
// Posting

const ACCOUNT_KEYS = {
  clearing: "razorpay_clearing",
  bank: "bank_default",
  revenue: "revenue_default",
  outputCgst: "gst_output_cgst",
  outputSgst: "gst_output_sgst",
  outputIgst: "gst_output_igst",
  inputCgst: "gst_input_cgst",
  inputSgst: "gst_input_sgst",
  inputIgst: "gst_input_igst",
  gatewayCharges: "gateway_charges",
  receivables: "trade_receivables",
  tdsReceivable: "tds_receivable",
} as const satisfies Record<keyof RuleAccounts, SystemAccountKey>

interface RuleContext {
  readonly accounts: RuleAccounts
  readonly org: RuleOrg
  readonly mappings: ReadonlyMap<string, EffectiveRate[]>
  readonly orgDefaultRates: readonly EffectiveRate[]
}

async function loadRuleContext(orgId: string): Promise<RuleContext> {
  const db = getDb()
  const [accountRows, settingsRows, mappingRows, defaultRows] = await db.batch([
    db
      .select({ id: ledgerAccounts.id, key: ledgerAccounts.systemKey })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.organizationId, orgId),
          inArray(ledgerAccounts.systemKey, Object.values(ACCOUNT_KEYS))
        )
      ),
    db
      .select({
        gstRegistered: organizationSettings.gstRegistered,
        compositionScheme: organizationSettings.compositionScheme,
        stateCode: organizationSettings.stateCode,
        defaultRate: organizationSettings.defaultGstRateBps,
      })
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, orgId))
      .limit(1),
    db
      .select({
        kind: gstRateMappings.kind,
        key: gstRateMappings.key,
        rateBps: gstRateMappings.gstRateBps,
        effectiveFrom: gstRateMappings.effectiveFrom,
        effectiveTo: gstRateMappings.effectiveTo,
      })
      .from(gstRateMappings)
      .where(eq(gstRateMappings.organizationId, orgId)),
    db
      .select({
        rateBps: organizationDefaultGstRates.gstRateBps,
        effectiveFrom: organizationDefaultGstRates.effectiveFrom,
        effectiveTo: organizationDefaultGstRates.effectiveTo,
      })
      .from(organizationDefaultGstRates)
      .where(eq(organizationDefaultGstRates.organizationId, orgId)),
  ])
  const byKey = new Map(accountRows.map((a) => [a.key, a.id]))
  const accounts = Object.fromEntries(
    Object.entries(ACCOUNT_KEYS).map(([name, key]) => {
      const id = byKey.get(key)
      if (!id)
        throw new ServiceError(
          "VALIDATION",
          `The chart of accounts is missing a system account (${key}).`
        )
      return [name, id]
    })
  ) as unknown as RuleAccounts
  const mappings = new Map<string, EffectiveRate[]>()
  for (const m of mappingRows) {
    const k = `${m.kind}:${m.key}`
    mappings.set(k, [...(mappings.get(k) ?? []), m])
  }
  const s = settingsRows[0]
  const undated =
    s?.defaultRate === null || s?.defaultRate === undefined
      ? []
      : [{ rateBps: s.defaultRate, effectiveFrom: null, effectiveTo: null }]
  return {
    accounts,
    org: {
      gstRegistered: s?.gstRegistered ?? false,
      compositionScheme: s?.compositionScheme ?? false,
      stateCode: s?.stateCode ?? null,
    },
    mappings,
    orgDefaultRates: defaultRows.length > 0 ? defaultRows : undated,
  }
}

interface StoredRow extends RuleRecord {
  readonly provider: string
  readonly reference: string | null
}

const recordColumns = {
  id: sourceRecords.id,
  kind: sourceRecords.kind,
  provider: sourceRecords.provider,
  externalId: sourceRecords.externalId,
  occurredAt: sourceRecords.occurredAt,
  amountPaise: sourceRecords.amountPaise,
  settlementExternalId: sourceRecords.settlementExternalId,
  reference: sourceRecords.reference,
  payload: sourceRecords.payload,
}

async function newRecords(
  orgId: string,
  connectionId: string,
  kinds: readonly SourceRecordKind[]
): Promise<StoredRow[]> {
  return getDb()
    .select(recordColumns)
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.organizationId, orgId),
        eq(sourceRecords.connectionId, connectionId),
        eq(sourceRecords.status, "new"),
        inArray(sourceRecords.kind, [...kinds])
      )
    )
    .orderBy(asc(sourceRecords.occurredAt), asc(sourceRecords.id))
    .limit(POST_BATCH)
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
function encodeTds(t: InboxTds | null): unknown {
  return t && { ...t, amount: String(t.amount) }
}

/** Books one decision and marks the record, in one transaction. */
async function applyDecision(
  orgId: string,
  record: StoredRow,
  decision: Decision,
  source: string
): Promise<"posted" | "inbox" | "wait" | "ignored"> {
  if (decision.action === "wait") return "wait"
  return withTransaction(async (tx) => {
    const mark = async (
      status: "posted" | "inbox" | "ignored",
      journalEntryId: string | null = null
    ) => {
      const updated = await tx
        .update(sourceRecords)
        .set({ status, journalEntryId })
        .where(
          and(
            eq(sourceRecords.organizationId, orgId),
            eq(sourceRecords.id, record.id),
            eq(sourceRecords.status, "new")
          )
        )
        .returning({ id: sourceRecords.id })
      // Someone else booked it meanwhile: roll back.
      if (updated.length === 0)
        throw new ServiceError("CONFLICT", "Record already booked.")
    }
    if (decision.action === "ignore") {
      await mark("ignored")
      return "ignored"
    }
    if (decision.action === "post") {
      const posted = await postEntry(
        { orgId, userId: null, source },
        {
          entryDate: decision.entry.entryDate,
          narration: decision.entry.narration,
          sourceType: "razorpay",
          sourceId: record.id,
          reversesEntryId: decision.reversesEntryId ?? null,
          lines: decision.entry.lines.map((l, i) => ({
            accountId: l.accountId,
            partyId: l.partyId,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
            dimensions: decision.dimensions?.[i] ?? null,
          })),
        },
        { tx }
      )
      await mark("posted", posted.id)
      return "posted"
    }
    await tx
      .insert(inboxItems)
      .values({
        organizationId: orgId,
        kind: decision.kind,
        proposedEntry: encodeProposedEntry(decision.entry),
        confidence: decision.confidence,
        reason: decision.reason,
        gst: encodeGst(decision.gst),
        tds: encodeTds(decision.tds),
        sourceType: "source_record",
        sourceId: record.id,
      })
      .onConflictDoNothing()
    await mark("inbox")
    return "inbox"
  })
}

async function decideAndApply(
  orgId: string,
  record: StoredRow,
  decision: Decision,
  source: string,
  tally: {
    posted: number
    sentToInbox: number
    postingErrors: { recordId: string; message: string }[]
  }
): Promise<void> {
  try {
    const outcome = await applyDecision(orgId, record, decision, source)
    if (outcome === "posted") tally.posted++
    if (outcome === "inbox") tally.sentToInbox++
  } catch (error) {
    if (!(error instanceof ServiceError) || decision.action !== "post")
      throw error
    if (error.code === "CONFLICT" && error.message === "Record already booked.")
      return
    // A rule's entry was refused (e.g. locked period): send it for review.
    tally.postingErrors.push({ recordId: record.id, message: error.message })
    const outcome = await applyDecision(
      orgId,
      record,
      {
        action: "inbox",
        kind:
          record.kind === "settlement" ? "settlement_gap" : "razorpay_record",
        entry: decision.entry,
        reason: `Couldn't post automatically: ${error.message}`,
        confidence: 0.5,
        gst: null,
        tds: null,
      },
      source
    )
    if (outcome === "inbox") tally.sentToInbox++
  }
}

async function openInvoicesByNumber(
  orgId: string,
  numbers: readonly string[]
): Promise<Map<string, OpenInvoice>> {
  if (numbers.length === 0) return new Map()
  const rows = await getDb()
    .select({
      id: invoices.id,
      number: invoices.number,
      partyId: invoices.partyId,
      total: invoices.totalPaise,
      taxable: invoices.taxablePaise,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, orgId),
        inArray(invoices.number, [...numbers]),
        inArray(invoices.status, ["issued", "partially_paid"])
      )
    )
  // A number reused across financial years is ambiguous: leave it unmatched.
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.number, (counts.get(r.number) ?? 0) + 1)
  return new Map(
    rows
      .filter((r) => counts.get(r.number) === 1)
      .map((r) => [
        r.number,
        { ...r, total: paise(r.total), taxable: paise(r.taxable) },
      ])
  )
}

/**
 * Runs the posting rules on the connection's unbooked records: payments and
 * fees, then refunds (which need their payment booked), then settlements.
 */
export async function postNewRecords(
  orgId: string,
  connectionId: string,
  source: string
): Promise<PostResult> {
  const ctx = await loadRuleContext(orgId)
  const tally = {
    posted: 0,
    sentToInbox: 0,
    postingErrors: [] as { recordId: string; message: string }[],
  }

  // Phase 1: payments and fees.
  const payments = await newRecords(orgId, connectionId, ["payment", "fee"])
  const invoiceNumbers = [
    ...new Set(
      payments.flatMap((p) => {
        const n = p.kind === "payment" ? paymentInvoiceNumber(p.payload) : null
        return n ? [n] : []
      })
    ),
  ]
  const openInvoices = await openInvoicesByNumber(orgId, invoiceNumbers)
  for (const record of payments) {
    let decision: Decision
    if (record.kind === "fee") {
      decision = feeRule(record, ctx)
    } else {
      const key = paymentMappingKey(record.payload)
      const number = paymentInvoiceNumber(record.payload)
      decision = paymentRule(record, {
        accounts: ctx.accounts,
        org: ctx.org,
        invoice: number ? (openInvoices.get(number) ?? null) : null,
        rate: resolveGstRate({
          supplyDate: istDateOf(record.occurredAt),
          gstRegistered: ctx.org.gstRegistered && !ctx.org.compositionScheme,
          mappingRates: key
            ? (ctx.mappings.get(`${key.kind}:${key.key}`) ?? [])
            : [],
          orgDefaultRates: ctx.orgDefaultRates,
        }),
      })
    }
    await decideAndApply(orgId, record, decision, source, tally)
  }

  // Phase 2: refunds, against their (now booked) payments.
  const refunds = await newRecords(orgId, connectionId, ["refund"])
  if (refunds.length > 0) {
    const paymentIds = [
      ...new Set(refunds.flatMap((r) => (r.reference ? [r.reference] : []))),
    ]
    const db = getDb()
    const originals =
      paymentIds.length === 0
        ? []
        : await db
            .select({
              id: sourceRecords.id,
              provider: sourceRecords.provider,
              externalId: sourceRecords.externalId,
              amountPaise: sourceRecords.amountPaise,
              status: sourceRecords.status,
              entryId: sourceRecords.journalEntryId,
              payload: sourceRecords.payload,
            })
            .from(sourceRecords)
            .where(
              and(
                eq(sourceRecords.organizationId, orgId),
                eq(sourceRecords.kind, "payment"),
                inArray(sourceRecords.externalId, paymentIds)
              )
            )
    const entryIds = originals.flatMap((o) => (o.entryId ? [o.entryId] : []))
    const [lines, refundedRows] = await Promise.all([
      entryIds.length === 0
        ? []
        : db
            .select({
              entryId: journalLines.entryId,
              accountId: journalLines.accountId,
              partyId: journalLines.partyId,
              debit: journalLines.debitPaise,
              credit: journalLines.creditPaise,
              dimensions: journalLines.dimensions,
            })
            .from(journalLines)
            .where(
              and(
                eq(journalLines.organizationId, orgId),
                inArray(journalLines.entryId, entryIds)
              )
            )
            .orderBy(asc(journalLines.lineNo)),
      paymentIds.length === 0
        ? []
        : db
            .select({
              paymentId: sourceRecords.reference,
              total: sql<string>`sum(${sourceRecords.amountPaise})`,
            })
            .from(sourceRecords)
            .where(
              and(
                eq(sourceRecords.organizationId, orgId),
                eq(sourceRecords.kind, "refund"),
                eq(sourceRecords.status, "posted"),
                inArray(sourceRecords.reference, paymentIds)
              )
            )
            .groupBy(sourceRecords.reference),
    ])
    const refundedBefore = new Map(
      refundedRows.map((r) => [r.paymentId, BigInt(r.total)])
    )
    for (const record of refunds) {
      const o = originals.find(
        (x) =>
          x.externalId === record.reference && x.provider === record.provider
      )
      const original: OriginalPayment | null = o
        ? {
            externalId: o.externalId ?? o.id,
            amountPaise: o.amountPaise,
            status: o.status,
            entryId: o.entryId,
            lines: lines
              .filter((l) => l.entryId === o.entryId)
              .map((l) => ({
                accountId: l.accountId,
                partyId: l.partyId,
                debit: l.debit,
                credit: l.credit,
                dimensions: l.dimensions,
              })),
            invoiced: paymentInvoiceNumber(o.payload) !== null,
          }
        : null
      const decision = refundRule(record, {
        accounts: ctx.accounts,
        original,
        refundedBefore: refundedBefore.get(record.reference) ?? 0n,
      })
      await decideAndApply(orgId, record, decision, source, tally)
      if (decision.action === "post" && record.reference)
        refundedBefore.set(
          record.reference,
          (refundedBefore.get(record.reference) ?? 0n) + record.amountPaise
        )
    }
  }

  // Phase 3: settlements, matched through Razorpay clearing.
  const settlements = await newRecords(orgId, connectionId, ["settlement"])
  if (settlements.length > 0) {
    const ids = settlements.flatMap((s) => (s.externalId ? [s.externalId] : []))
    const sums = await getDb()
      .select({
        settlementId: sourceRecords.settlementExternalId,
        kind: sourceRecords.kind,
        total: sql<string>`sum(${sourceRecords.amountPaise})`,
        count: sql<number>`count(*)::int`,
      })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.organizationId, orgId),
          inArray(sourceRecords.settlementExternalId, ids),
          inArray(sourceRecords.kind, ["payment", "fee", "refund"])
        )
      )
      .groupBy(sourceRecords.settlementExternalId, sourceRecords.kind)
    for (const record of settlements) {
      const mine = sums.filter(
        (s) => s.settlementId === record.externalId && s.settlementId !== null
      )
      const total = (kind: string) =>
        BigInt(mine.find((s) => s.kind === kind)?.total ?? "0")
      const linked: SettlementTotals = {
        payments: total("payment"),
        fees: total("fee"),
        refunds: total("refund"),
        count: mine.reduce((n, s) => n + s.count, 0),
      }
      await decideAndApply(
        orgId,
        record,
        settlementRule(record, { accounts: ctx.accounts, linked }),
        source,
        tally
      )
    }
  }
  return tally
}

// ---------------------------------------------------------------------------
// Running a sync

export interface RunSyncResult extends StoreResult, PostResult {
  readonly status: ConnectionStatus
  readonly lastSyncedAt: Date
}

/**
 * Syncs one API connection: claims it (status "syncing"), pulls batches from
 * the connector, stores each and saves its cursor, then posts. Auth failures
 * mark the connection reconnect_required/revoked. Throws NOT_FOUND,
 * VALIDATION, CONFLICT (already syncing), INTEGRATION. Consent and
 * permissions are the caller's job.
 */
export async function runSync(
  orgId: string,
  connectionId: string,
  source: string
): Promise<RunSyncResult> {
  const db = getDb()
  const [connection] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.organizationId, orgId),
        eq(connections.id, connectionId)
      )
    )
    .limit(1)
  if (!connection) throw new ServiceError("NOT_FOUND", "Connection not found.")
  const connector = getConnector(connection.provider)
  if (!connector)
    throw new ServiceError(
      "NOT_FOUND",
      `No connector "${connection.provider}".`
    )
  if (isFileConnector(connector))
    throw new ServiceError(
      "VALIDATION",
      "File connections import with importFile."
    )
  if (connection.status === "disconnected" || !connection.credentialsEncrypted)
    throw new ServiceError(
      "VALIDATION",
      "This connection is disconnected. Connect it again."
    )
  if (
    connection.status === "reconnect_required" ||
    connection.status === "revoked"
  )
    throw new ServiceError(
      "INTEGRATION",
      `${connector.info.displayName} needs to be reconnected.`
    )

  // Claim: only one sync per connection at a time.
  const claimed = await db
    .update(connections)
    .set({ status: "syncing" })
    .where(
      and(
        eq(connections.organizationId, orgId),
        eq(connections.id, connectionId),
        or(
          inArray(connections.status, ["connected", "error"]),
          and(
            eq(connections.status, "syncing"),
            lt(connections.updatedAt, new Date(Date.now() - STALE_SYNC_MS))
          )
        )
      )
    )
    .returning({ id: connections.id })
  if (claimed.length === 0)
    throw new ServiceError("CONFLICT", "A sync is already running.")

  const finish = (
    status: ConnectionStatus,
    lastError: string | null,
    extra: { lastSyncedAt?: Date } = {}
  ) =>
    db
      .update(connections)
      .set({ status, lastError, ...extra })
      .where(
        and(
          eq(connections.organizationId, orgId),
          eq(connections.id, connectionId)
        )
      )

  const fetched: Partial<Record<SourceRecordKind, number>> = {}
  let inserted = 0
  let skippedExisting = 0
  const errors: { index: number; message: string }[] = []
  try {
    const credentials = decryptCredentials(
      connection.credentialsEncrypted,
      { orgId, provider: connection.provider },
      connector.credentialsSchema
    )
    let cursor: ConnectorCursor | null = connection.cursor ?? null
    for await (const batch of connector.sync(
      { orgId, connectionId, credentials, now: new Date() },
      cursor
    )) {
      const stored = await storeRecords(orgId, connectionId, batch.records)
      for (const [kind, n] of Object.entries(stored.fetched))
        fetched[kind as SourceRecordKind] =
          (fetched[kind as SourceRecordKind] ?? 0) + n
      inserted += stored.inserted
      skippedExisting += stored.skippedExisting
      errors.push(...stored.errors)
      if (batch.settlementLinks?.length)
        await applySettlementLinks(
          orgId,
          connection.provider,
          batch.settlementLinks
        )
      cursor = batch.cursor
      await db
        .update(connections)
        .set({ cursor: { ...cursor } })
        .where(
          and(
            eq(connections.organizationId, orgId),
            eq(connections.id, connectionId)
          )
        )
    }
    const posting = await postNewRecords(orgId, connectionId, source)
    const lastSyncedAt = new Date()
    await finish("connected", null, { lastSyncedAt })
    return {
      fetched,
      inserted,
      skippedExisting,
      errors,
      ...posting,
      status: "connected",
      lastSyncedAt,
    }
  } catch (error) {
    if (error instanceof ConnectorAuthError) {
      await finish(error.status, error.message)
      throw new ServiceError("INTEGRATION", error.message)
    }
    if (error instanceof ConnectorError) {
      await finish("error", error.message)
      throw new ServiceError("INTEGRATION", error.message)
    }
    if (error instanceof ServiceError) {
      await finish("error", error.message)
      throw error
    }
    await finish(
      "error",
      "Sync failed. Try again; if it keeps failing, contact support."
    )
    throw error
  }
}
