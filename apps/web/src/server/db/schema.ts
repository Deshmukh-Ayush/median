// Drizzle schema for Median.
//
// Rules (see CLAUDE.md):
// - every business table has `organization_id`, and every index on a query
//   path starts with it;
// - money columns are `bigint` paise (`bigint({ mode: "bigint" })`);
// - posted ledger rows are append-only (enforced by triggers in the
//   `ledger_append_only` migration as well as in code).
//
// Ledger tables reference each other through composite (organization_id, id)
// foreign keys, so a row can never point at another organisation's data.

import { relations, sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { organization, user } from "./auth-schema"

export * from "./auth-schema"

// ---------------------------------------------------------------------------
// Shared column helpers

const id = () => uuid().primaryKey().defaultRandom()
const organizationId = () =>
  text()
    .notNull()
    .references(() => organization.id, { onDelete: "restrict" })
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
/** Integer paise. Never a float. */
const paise = () => bigint({ mode: "bigint" })
/** Calendar date as an ISO string (YYYY-MM-DD). */
const isoDate = () => date({ mode: "string" })

// ---------------------------------------------------------------------------
// Enums

export const accountType = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
])

export const industryTemplate = pgEnum("industry_template", [
  "saas",
  "d2c",
  "agency",
])

export const partyKind = pgEnum("party_kind", ["customer", "vendor"])

export const journalSourceType = pgEnum("journal_source_type", [
  "manual",
  "razorpay",
  "bank",
  "invoice",
  "bill",
  "inbox",
  "reversal",
  "opening_balance",
])

export const connectionProvider = pgEnum("connection_provider", [
  "razorpay",
  "bank",
])

export const connectionStatus = pgEnum("connection_status", [
  "active",
  "error",
  "disconnected",
])

export const sourceRecordKind = pgEnum("source_record_kind", [
  "payment",
  "refund",
  "fee",
  "settlement",
  "payout",
  "bank_line",
])

export const flowDirection = pgEnum("flow_direction", ["inflow", "outflow"])

export const sourceRecordStatus = pgEnum("source_record_status", [
  "new",
  "posted",
  "inbox",
  "ignored",
])

export const documentKind = pgEnum("document_kind", ["bill", "bank_statement"])

export const documentStatus = pgEnum("document_status", [
  "uploaded",
  "extracting",
  "extracted",
  "failed",
])

export const inboxItemKind = pgEnum("inbox_item_kind", [
  "bill",
  "bank_line",
  "razorpay_record",
  "settlement_gap",
])

export const inboxSourceType = pgEnum("inbox_source_type", [
  "document",
  "source_record",
])

export const inboxStatus = pgEnum("inbox_status", [
  "pending",
  "approved",
  "rejected",
])

export const invoiceStatus = pgEnum("invoice_status", [
  "issued",
  "partially_paid",
  "paid",
  "cancelled",
])

// ---------------------------------------------------------------------------
// Organisation settings (one row per Better Auth organisation)

export const organizationSettings = pgTable(
  "organization_settings",
  {
    organizationId: text()
      .primaryKey()
      .references(() => organization.id, { onDelete: "restrict" }),
    legalName: text(),
    gstin: text(),
    /** Two-digit GST state code, e.g. "29" for Karnataka. */
    stateCode: text(),
    industry: industryTemplate().notNull().default("saas"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "organization_settings_state_code_check",
      sql`${t.stateCode} is null or ${t.stateCode} ~ '^[0-9]{2}$'`
    ),
  ]
)

// ---------------------------------------------------------------------------
// Chart of accounts

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: id(),
    organizationId: organizationId(),
    code: text().notNull(),
    name: text().notNull(),
    type: accountType().notNull(),
    parentId: uuid(),
    /** System accounts are created by the template and can't be deleted. */
    isSystem: boolean().notNull().default(false),
    /**
     * Stable key the deterministic rules use to find an account
     * (e.g. "razorpay_clearing", "gst_output_cgst"). Null for user accounts.
     */
    systemKey: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("ledger_accounts_org_id_uq").on(t.organizationId, t.id),
    unique("ledger_accounts_org_code_uq").on(t.organizationId, t.code),
    uniqueIndex("ledger_accounts_org_system_key_uq")
      .on(t.organizationId, t.systemKey)
      .where(sql`${t.systemKey} is not null`),
    index("ledger_accounts_org_type_idx").on(t.organizationId, t.type),
    index("ledger_accounts_org_parent_idx").on(t.organizationId, t.parentId),
    foreignKey({
      name: "ledger_accounts_parent_fk",
      columns: [t.organizationId, t.parentId],
      foreignColumns: [t.organizationId, t.id],
    }),
  ]
)

// ---------------------------------------------------------------------------
// Parties (customers and vendors)

export const parties = pgTable(
  "parties",
  {
    id: id(),
    organizationId: organizationId(),
    kind: partyKind().notNull(),
    name: text().notNull(),
    gstin: text(),
    stateCode: text(),
    email: text(),
    phone: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("parties_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("parties_org_kind_gstin_uq")
      .on(t.organizationId, t.kind, t.gstin)
      .where(sql`${t.gstin} is not null`),
    index("parties_org_gstin_idx").on(t.organizationId, t.gstin),
    index("parties_org_kind_name_idx").on(t.organizationId, t.kind, t.name),
    check(
      "parties_state_code_check",
      sql`${t.stateCode} is null or ${t.stateCode} ~ '^[0-9]{2}$'`
    ),
  ]
)

// ---------------------------------------------------------------------------
// Ledger (append-only)

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: id(),
    organizationId: organizationId(),
    entryDate: isoDate().notNull(),
    narration: text().notNull(),
    sourceType: journalSourceType().notNull(),
    /** Id of the record that produced this entry (invoice, source record…). */
    sourceId: text(),
    reversesEntryId: uuid(),
    /** Null when a deterministic rule posted the entry (see audit_log.source). */
    createdBy: text().references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("journal_entries_org_id_uq").on(t.organizationId, t.id),
    index("journal_entries_org_date_idx").on(
      t.organizationId,
      t.entryDate,
      t.id
    ),
    index("journal_entries_org_source_idx").on(
      t.organizationId,
      t.sourceType,
      t.sourceId
    ),
    // An entry can be reversed at most once.
    uniqueIndex("journal_entries_org_reverses_uq")
      .on(t.organizationId, t.reversesEntryId)
      .where(sql`${t.reversesEntryId} is not null`),
    foreignKey({
      name: "journal_entries_reverses_fk",
      columns: [t.organizationId, t.reversesEntryId],
      foreignColumns: [t.organizationId, t.id],
    }),
  ]
)

export const journalLines = pgTable(
  "journal_lines",
  {
    id: id(),
    organizationId: organizationId(),
    entryId: uuid().notNull(),
    /** Position of the line within its entry, from 0. */
    lineNo: integer().notNull(),
    /** Copy of journal_entries.entry_date so reports scan one table. */
    entryDate: isoDate().notNull(),
    accountId: uuid().notNull(),
    partyId: uuid(),
    debitPaise: paise()
      .notNull()
      .default(sql`0`),
    creditPaise: paise()
      .notNull()
      .default(sql`0`),
    description: text(),
    /** Free-form tags for reporting, e.g. { "project": "acme-redesign" }. */
    dimensions: jsonb().$type<Record<string, string>>(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("journal_lines_org_entry_line_uq").on(
      t.organizationId,
      t.entryId,
      t.lineNo
    ),
    index("journal_lines_org_account_date_idx").on(
      t.organizationId,
      t.accountId,
      t.entryDate
    ),
    index("journal_lines_org_party_date_idx")
      .on(t.organizationId, t.partyId, t.entryDate)
      .where(sql`${t.partyId} is not null`),
    foreignKey({
      name: "journal_lines_entry_fk",
      columns: [t.organizationId, t.entryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    foreignKey({
      name: "journal_lines_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [ledgerAccounts.organizationId, ledgerAccounts.id],
    }),
    foreignKey({
      name: "journal_lines_party_fk",
      columns: [t.organizationId, t.partyId],
      foreignColumns: [parties.organizationId, parties.id],
    }),
    check(
      "journal_lines_one_sided_check",
      sql`${t.debitPaise} >= 0 and ${t.creditPaise} >= 0 and (${t.debitPaise} = 0) <> (${t.creditPaise} = 0)`
    ),
  ]
)

export const periodLocks = pgTable(
  "period_locks",
  {
    id: id(),
    organizationId: organizationId(),
    /** YYYY-MM */
    period: text().notNull(),
    lockedBy: text()
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    lockedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("period_locks_org_period_uq").on(t.organizationId, t.period),
    check(
      "period_locks_period_check",
      sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`
    ),
  ]
)

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    organizationId: organizationId(),
    /** Null for system actions; `source` says which system. */
    actorId: text().references(() => user.id, { onDelete: "restrict" }),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text().notNull(),
    before: jsonb(),
    after: jsonb(),
    /** Where the change came from: "web", "razorpay_rule", "bank_match"… */
    source: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_org_at_idx").on(t.organizationId, t.at, t.id),
    index("audit_log_org_entity_idx").on(
      t.organizationId,
      t.entity,
      t.entityId
    ),
  ]
)

// ---------------------------------------------------------------------------
// Integrations

export const connections = pgTable(
  "connections",
  {
    id: id(),
    organizationId: organizationId(),
    provider: connectionProvider().notNull(),
    /** Display label, e.g. "HDFC current a/c" or "Razorpay live". */
    label: text().notNull(),
    /** AES-256-GCM ciphertext (base64). Null for bank CSV imports. */
    credentialsEncrypted: text(),
    /** Last four characters of the key id, for display only. */
    keyHint: text(),
    /** Bank connections post to this ledger account. */
    ledgerAccountId: uuid(),
    status: connectionStatus().notNull().default("active"),
    lastSyncedAt: timestamp({ withTimezone: true }),
    /** Provider-specific sync position, e.g. { "payments": 1730000000 }. */
    syncCursor: jsonb().$type<Record<string, number | string>>(),
    lastError: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("connections_org_id_uq").on(t.organizationId, t.id),
    index("connections_org_provider_idx").on(t.organizationId, t.provider),
    foreignKey({
      name: "connections_ledger_account_fk",
      columns: [t.organizationId, t.ledgerAccountId],
      foreignColumns: [ledgerAccounts.organizationId, ledgerAccounts.id],
    }),
  ]
)

export const sourceRecords = pgTable(
  "source_records",
  {
    id: id(),
    organizationId: organizationId(),
    connectionId: uuid().notNull(),
    provider: connectionProvider().notNull(),
    externalId: text().notNull(),
    kind: sourceRecordKind().notNull(),
    direction: flowDirection().notNull(),
    /** Always a non-negative magnitude; `direction` carries the sign. */
    amountPaise: paise().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    /** Bank reference / UTR, Razorpay order id, etc. */
    reference: text(),
    /** Razorpay settlement id this record was paid out in, once known. */
    settlementExternalId: text(),
    status: sourceRecordStatus().notNull().default("new"),
    journalEntryId: uuid(),
    payload: jsonb().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("source_records_org_provider_external_uq").on(
      t.organizationId,
      t.provider,
      t.externalId
    ),
    index("source_records_org_kind_occurred_idx").on(
      t.organizationId,
      t.kind,
      t.occurredAt
    ),
    index("source_records_org_status_occurred_idx").on(
      t.organizationId,
      t.status,
      t.occurredAt
    ),
    index("source_records_org_settlement_idx")
      .on(t.organizationId, t.settlementExternalId)
      .where(sql`${t.settlementExternalId} is not null`),
    index("source_records_org_connection_occurred_idx").on(
      t.organizationId,
      t.connectionId,
      t.occurredAt
    ),
    foreignKey({
      name: "source_records_connection_fk",
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [connections.organizationId, connections.id],
    }),
    foreignKey({
      name: "source_records_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    check("source_records_amount_check", sql`${t.amountPaise} >= 0`),
  ]
)

// ---------------------------------------------------------------------------
// Documents and the approval inbox

export const documents = pgTable(
  "documents",
  {
    id: id(),
    organizationId: organizationId(),
    kind: documentKind().notNull(),
    blobUrl: text().notNull(),
    fileName: text().notNull(),
    mimeType: text().notNull(),
    status: documentStatus().notNull().default("uploaded"),
    /** Raw AI extraction, kept for audit. Never trusted without Zod. */
    extracted: jsonb(),
    uploadedBy: text().references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("documents_org_id_uq").on(t.organizationId, t.id),
    index("documents_org_created_idx").on(t.organizationId, t.createdAt, t.id),
    index("documents_org_status_idx").on(t.organizationId, t.status),
  ]
)

export const inboxItems = pgTable(
  "inbox_items",
  {
    id: id(),
    organizationId: organizationId(),
    kind: inboxItemKind().notNull(),
    /**
     * The entry to post on approval. Amounts are integer-paise strings
     * (JSON has no bigint); parse with `proposedEntrySchema`.
     */
    proposedEntry: jsonb().notNull(),
    /** 0–1. Not money, so a float is fine here. */
    confidence: real().notNull(),
    reason: text().notNull(),
    sourceType: inboxSourceType().notNull(),
    sourceId: uuid().notNull(),
    status: inboxStatus().notNull().default("pending"),
    reviewedBy: text().references(() => user.id, { onDelete: "restrict" }),
    reviewedAt: timestamp({ withTimezone: true }),
    reviewNote: text(),
    postedEntryId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("inbox_items_org_status_created_idx").on(
      t.organizationId,
      t.status,
      t.createdAt,
      t.id
    ),
    // One inbox item per source document / record.
    unique("inbox_items_org_source_uq").on(
      t.organizationId,
      t.sourceType,
      t.sourceId
    ),
    foreignKey({
      name: "inbox_items_posted_entry_fk",
      columns: [t.organizationId, t.postedEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    check(
      "inbox_items_confidence_check",
      sql`${t.confidence} >= 0 and ${t.confidence} <= 1`
    ),
  ]
)

// ---------------------------------------------------------------------------
// Sales invoices

/** Next invoice number per organisation and financial year ("2026-27"). */
export const invoiceSeries = pgTable(
  "invoice_series",
  {
    organizationId: organizationId(),
    financialYear: text().notNull(),
    prefix: text().notNull(),
    nextNumber: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.financialYear] }),
    check(
      "invoice_series_fy_check",
      sql`${t.financialYear} ~ '^[0-9]{4}-[0-9]{2}$'`
    ),
  ]
)

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    organizationId: organizationId(),
    number: text().notNull(),
    financialYear: text().notNull(),
    partyId: uuid().notNull(),
    invoiceDate: isoDate().notNull(),
    dueDate: isoDate().notNull(),
    /** Two-digit GST state code of the place of supply. */
    placeOfSupply: text().notNull(),
    taxablePaise: paise().notNull(),
    cgstPaise: paise().notNull(),
    sgstPaise: paise().notNull(),
    igstPaise: paise().notNull(),
    totalPaise: paise().notNull(),
    paidPaise: paise()
      .notNull()
      .default(sql`0`),
    status: invoiceStatus().notNull().default("issued"),
    notes: text(),
    journalEntryId: uuid(),
    createdBy: text().references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("invoices_org_id_uq").on(t.organizationId, t.id),
    unique("invoices_org_number_uq").on(t.organizationId, t.number),
    index("invoices_org_date_idx").on(t.organizationId, t.invoiceDate, t.id),
    index("invoices_org_party_date_idx").on(
      t.organizationId,
      t.partyId,
      t.invoiceDate
    ),
    index("invoices_org_status_due_idx").on(
      t.organizationId,
      t.status,
      t.dueDate
    ),
    foreignKey({
      name: "invoices_party_fk",
      columns: [t.organizationId, t.partyId],
      foreignColumns: [parties.organizationId, parties.id],
    }),
    foreignKey({
      name: "invoices_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    check(
      "invoices_amounts_check",
      sql`${t.taxablePaise} >= 0 and ${t.cgstPaise} >= 0 and ${t.sgstPaise} >= 0 and ${t.igstPaise} >= 0 and ${t.paidPaise} >= 0 and ${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`
    ),
    check(
      "invoices_place_of_supply_check",
      sql`${t.placeOfSupply} ~ '^[0-9]{2}$'`
    ),
  ]
)

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    organizationId: organizationId(),
    invoiceId: uuid().notNull(),
    lineNo: integer().notNull(),
    description: text().notNull(),
    hsnSac: text().notNull(),
    /** Quantity in thousandths (1.5 units = 1500), so no floats. */
    quantityMilli: bigint({ mode: "bigint" }).notNull(),
    unitPricePaise: paise().notNull(),
    /** GST rate in basis points (18% = 1800). */
    gstRateBps: integer().notNull(),
    taxablePaise: paise().notNull(),
    cgstPaise: paise().notNull(),
    sgstPaise: paise().notNull(),
    igstPaise: paise().notNull(),
    totalPaise: paise().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("invoice_lines_org_invoice_line_uq").on(
      t.organizationId,
      t.invoiceId,
      t.lineNo
    ),
    foreignKey({
      name: "invoice_lines_invoice_fk",
      columns: [t.organizationId, t.invoiceId],
      foreignColumns: [invoices.organizationId, invoices.id],
    }),
    check(
      "invoice_lines_amounts_check",
      sql`${t.quantityMilli} > 0 and ${t.unitPricePaise} >= 0 and ${t.gstRateBps} between 0 and 10000 and ${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`
    ),
  ]
)

// ---------------------------------------------------------------------------
// Relations (for the relational query API)

export const journalEntriesRelations = relations(
  journalEntries,
  ({ many }) => ({
    lines: many(journalLines),
  })
)

export const journalLinesRelations = relations(journalLines, ({ one }) => ({
  entry: one(journalEntries, {
    fields: [journalLines.entryId],
    references: [journalEntries.id],
  }),
  account: one(ledgerAccounts, {
    fields: [journalLines.accountId],
    references: [ledgerAccounts.id],
  }),
  party: one(parties, {
    fields: [journalLines.partyId],
    references: [parties.id],
  }),
}))

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  party: one(parties, { fields: [invoices.partyId], references: [parties.id] }),
  lines: many(invoiceLines),
}))

export const invoiceLinesRelations = relations(invoiceLines, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceLines.invoiceId],
    references: [invoices.id],
  }),
}))
