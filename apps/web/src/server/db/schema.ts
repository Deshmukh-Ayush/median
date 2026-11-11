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

export const partyKind = pgEnum("party_kind", ["customer", "vendor"])

/** GST registration of a customer or vendor. */
export const partyRegistrationType = pgEnum("party_registration_type", [
  "regular",
  "composition",
  "unregistered",
  "sez",
  "overseas",
])

/** Udyam category. Section 43B(h) covers micro and small, not medium. */
export const msmeCategory = pgEnum("msme_category", [
  "micro",
  "small",
  "medium",
])

export const journalSourceType = pgEnum("journal_source_type", [
  "manual",
  "razorpay",
  "bank",
  "invoice",
  "bill",
  "inbox",
  "reversal",
  "opening_balance",
  "credit_note",
])

/**
 * reconnect_required: the provider rejected our token (expired, scopes
 * changed); revoked: the user revoked access at the provider. Both need the
 * user to connect again.
 */
export const connectionStatus = pgEnum("connection_status", [
  "connected",
  "syncing",
  "error",
  "reconnect_required",
  "revoked",
  "disconnected",
])

export const connectorAuthType = pgEnum("connector_auth_type", [
  "api_key",
  "oauth",
  "file",
])

export const businessType = pgEnum("business_type", ["saas", "d2c", "agency"])

export const sourceRecordKind = pgEnum("source_record_kind", [
  "payment",
  "refund",
  "fee",
  "settlement",
  "payout",
  "bank_line",
  "order",
  "invoice",
  "party",
  "opening_balance",
  "account",
  "voucher",
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

export const supplyType = pgEnum("supply_type", [
  "intrastate",
  "interstate",
  "export_with_payment",
  "export_lut",
  "sez",
])

export const gstRateMappingKind = pgEnum("gst_rate_mapping_kind", [
  "product",
  "stream",
])

export const creditNoteReason = pgEnum("credit_note_reason", [
  "refund",
  "sales_return",
  "post_sale_discount",
  "deficiency_in_service",
  "correction",
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
    businessType: businessType().notNull().default("saas"),
    // GST profile. Unregistered (the default until onboarding sets it) means
    // no GST is charged or split anywhere.
    gstRegistered: boolean().notNull().default(false),
    /** Composition dealers issue bills of supply and collect no GST. */
    compositionScheme: boolean().notNull().default(false),
    /** Rate for sales with no invoice or mapping, in basis points. Null → inbox. */
    defaultGstRateBps: integer(),
    /** Invoices fall due this many days after issue unless the customer has terms. */
    defaultPaymentTermsDays: integer().notNull().default(30),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "organization_settings_state_code_check",
      sql`${t.stateCode} is null or ${t.stateCode} ~ '^[0-9]{2}$'`
    ),
    check(
      "organization_settings_default_rate_check",
      sql`${t.defaultGstRateBps} is null or ${t.defaultGstRateBps} between 0 and 10000`
    ),
    check(
      "organization_settings_payment_terms_check",
      sql`${t.defaultPaymentTermsDays} between 0 and 365`
    ),
    check(
      "organization_settings_gstin_when_registered_check",
      sql`not ${t.gstRegistered} or ${t.gstin} is not null`
    ),
  ]
)

/**
 * GST rate for things sold without an invoice (Razorpay payments), keyed by
 * a product id or a revenue stream name the payment carries.
 */
export const gstRateMappings = pgTable(
  "gst_rate_mappings",
  {
    id: id(),
    organizationId: organizationId(),
    kind: gstRateMappingKind().notNull(),
    /** Razorpay item/plan id for products; a stream name such as "subscriptions". */
    key: text().notNull(),
    label: text().notNull(),
    hsnSac: text(),
    gstRateBps: integer().notNull(),
    /** First day this rate applies (inclusive); null = since GST began. */
    effectiveFrom: isoDate(),
    /** Last day this rate applies (inclusive); null = still in force. */
    effectiveTo: isoDate(),
    /** Revenue account to credit; null → the org's default revenue account. */
    revenueAccountId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One row per rate window; windows for a key never overlap (exclusion
    // constraint in migration 0007).
    unique("gst_rate_mappings_org_kind_key_from_uq")
      .on(t.organizationId, t.kind, t.key, t.effectiveFrom)
      .nullsNotDistinct(),
    check(
      "gst_rate_mappings_window_check",
      sql`${t.effectiveFrom} is null or ${t.effectiveTo} is null or ${t.effectiveFrom} <= ${t.effectiveTo}`
    ),
    foreignKey({
      name: "gst_rate_mappings_revenue_account_fk",
      columns: [t.organizationId, t.revenueAccountId],
      foreignColumns: [ledgerAccounts.organizationId, ledgerAccounts.id],
    }),
    check(
      "gst_rate_mappings_rate_check",
      sql`${t.gstRateBps} between 0 and 10000`
    ),
  ]
)

/**
 * The org's default GST rate over time (rule 8 fallback), so a payment is
 * split at the default valid on its supply date. When an org has no rows
 * here, `organization_settings.default_gst_rate_bps` applies to all dates.
 */
export const organizationDefaultGstRates = pgTable(
  "organization_default_gst_rates",
  {
    id: id(),
    organizationId: organizationId(),
    gstRateBps: integer().notNull(),
    effectiveFrom: isoDate(),
    effectiveTo: isoDate(),
    createdBy: text()
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("organization_default_gst_rates_org_from_uq")
      .on(t.organizationId, t.effectiveFrom)
      .nullsNotDistinct(),
    check(
      "organization_default_gst_rates_rate_check",
      sql`${t.gstRateBps} between 0 and 10000`
    ),
    check(
      "organization_default_gst_rates_window_check",
      sql`${t.effectiveFrom} is null or ${t.effectiveTo} is null or ${t.effectiveFrom} <= ${t.effectiveTo}`
    ),
  ]
)

// ---------------------------------------------------------------------------
// HSN/SAC master (reference data shared by every organisation, so no
// organization_id). Starts empty; filled only from official notifications by
// scripts/import-hsn-sac-rates.ts. Never invent rates.

export const hsnSacCodes = pgTable(
  "hsn_sac_codes",
  {
    /** 2, 4, 6 or 8 digits. Rates may be defined on a parent heading. */
    code: text().primaryKey(),
    kind: text({ enum: ["hsn", "sac"] }).notNull(),
    description: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "hsn_sac_codes_code_check",
      sql`${t.code} ~ '^([0-9]{2}|[0-9]{4}|[0-9]{6}|[0-9]{8})$'`
    ),
    check(
      "hsn_sac_codes_kind_check",
      sql`(${t.kind} = 'sac') = (${t.code} like '99%')`
    ),
  ]
)

export const hsnSacRates = pgTable(
  "hsn_sac_rates",
  {
    id: id(),
    code: text()
      .notNull()
      .references(() => hsnSacCodes.code, { onDelete: "restrict" }),
    gstRateBps: integer().notNull(),
    effectiveFrom: isoDate().notNull(),
    effectiveTo: isoDate(),
    /** e.g. "sale value per piece up to ₹2,500"; null if unconditional. */
    condition: text(),
    /** Notification the rate comes from. */
    source: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("hsn_sac_rates_code_from_condition_uq")
      .on(t.code, t.effectiveFrom, t.condition)
      .nullsNotDistinct(),
    index("hsn_sac_rates_code_from_idx").on(t.code, t.effectiveFrom),
    check("hsn_sac_rates_rate_check", sql`${t.gstRateBps} between 0 and 10000`),
    check(
      "hsn_sac_rates_window_check",
      sql`${t.effectiveTo} is null or ${t.effectiveFrom} <= ${t.effectiveTo}`
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
    /** A bank account: bank-statement connections post to it. */
    isBank: boolean().notNull().default(false),
    /** Bank accounts: the bank's name, e.g. "HDFC Bank". */
    bankName: text(),
    /** Bank accounts: last four digits of the account number, for display. */
    accountLast4: text(),
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
    check(
      "ledger_accounts_last4_check",
      sql`${t.accountLast4} is null or ${t.accountLast4} ~ '^[0-9]{4}$'`
    ),
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
    /** As on the GST certificate or PAN, when it differs from `name`. */
    legalName: text(),
    gstin: text(),
    /** Derived from the GSTIN when there is one. */
    pan: text(),
    registrationType: partyRegistrationType().notNull().default("unregistered"),
    stateCode: text(),
    billingAddress: text(),
    email: text(),
    phone: text(),
    /** Null → the organisation's default terms. */
    paymentTermsDays: integer(),
    /** Vendors only: TDS section usually deducted, e.g. "194J(b)". */
    defaultTdsSection: text(),
    msmeCategory: msmeCategory(),
    udyamNumber: text(),
    /** Archived parties are hidden from pickers; their history stays. */
    archivedAt: timestamp({ withTimezone: true }),
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
    index("parties_org_name_idx").on(t.organizationId, t.name, t.id),
    check(
      "parties_state_code_check",
      sql`${t.stateCode} is null or ${t.stateCode} ~ '^[0-9]{2}$'`
    ),
    check(
      "parties_pan_check",
      sql`${t.pan} is null or ${t.pan} ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'`
    ),
    check(
      "parties_gstin_registration_check",
      sql`(${t.gstin} is not null) = (${t.registrationType} in ('regular', 'composition', 'sez'))`
    ),
    check(
      "parties_payment_terms_check",
      sql`${t.paymentTermsDays} is null or ${t.paymentTermsDays} between 0 and 365`
    ),
    check(
      "parties_tds_vendor_only_check",
      sql`${t.defaultTdsSection} is null or ${t.kind} = 'vendor'`
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
    // listEntries filtered by source type, newest first.
    index("journal_entries_org_source_date_idx").on(
      t.organizationId,
      t.sourceType,
      t.entryDate,
      t.id
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
    // Account drill-downs (listEntries, newest first by entry) and
    // cumulative per-account sums (trial balance, balance sheet), both as
    // index-only scans.
    index("journal_lines_org_account_date_idx").on(
      t.organizationId,
      t.accountId,
      t.entryDate,
      t.entryId,
      t.debitPaise,
      t.creditPaise
    ),
    // Party drill-downs, newest first by entry.
    index("journal_lines_org_party_date_idx")
      .on(t.organizationId, t.partyId, t.entryDate, t.entryId)
      .where(sql`${t.partyId} is not null`),
    // Per-account sums over a short date range (P&L, dashboard months).
    index("journal_lines_org_date_cover_idx").on(
      t.organizationId,
      t.entryDate,
      t.accountId,
      t.debitPaise,
      t.creditPaise
    ),
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
    /** Connector id from integrations/registry.ts, e.g. "razorpay". */
    provider: text().notNull(),
    authType: connectorAuthType().notNull(),
    /** Display label, e.g. "HDFC current a/c" or "Razorpay live". */
    label: text().notNull(),
    /** AES-256-GCM ciphertext (base64). Null for bank CSV imports. */
    credentialsEncrypted: text(),
    /** Last four characters of the key id, for display only. */
    keyHint: text(),
    /** Bank connections post to this ledger account. */
    ledgerAccountId: uuid(),
    /** Razorpay: the bank account settlements are paid into. Null → first bank account. */
    settlementBankAccountId: uuid(),
    /**
     * Razorpay: GST state the gateway bills its fees from, deciding CGST+SGST
     * vs IGST on fee input credit. Null → Karnataka (29). For the CA to verify
     * against Razorpay's tax invoice.
     */
    feeGstStateCode: text(),
    status: connectionStatus().notNull().default("connected"),
    lastSyncedAt: timestamp({ withTimezone: true }),
    /** Connector-specific sync position, e.g. { "payments": 1730000000 }. */
    cursor: jsonb().$type<Record<string, number | string>>(),
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
    foreignKey({
      name: "connections_settlement_bank_fk",
      columns: [t.organizationId, t.settlementBankAccountId],
      foreignColumns: [ledgerAccounts.organizationId, ledgerAccounts.id],
    }),
    check(
      "connections_fee_gst_state_check",
      sql`${t.feeGstStateCode} is null or ${t.feeGstStateCode} ~ '^[0-9]{2}$'`
    ),
  ]
)

export const sourceRecords = pgTable(
  "source_records",
  {
    id: id(),
    organizationId: organizationId(),
    connectionId: uuid().notNull(),
    /** Connector id, as on the connection. */
    provider: text().notNull(),
    /** The provider's id. Null for file rows, which use dedupe_hash instead. */
    externalId: text(),
    /** Content hash for rows with no stable id (bank statement lines). */
    dedupeHash: text(),
    kind: sourceRecordKind().notNull(),
    /** ISO 4217, e.g. "INR". */
    currency: text().notNull().default("INR"),
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
    unique("source_records_org_id_uq").on(t.organizationId, t.id),
    unique("source_records_org_provider_external_uq").on(
      t.organizationId,
      t.provider,
      t.externalId
    ),
    uniqueIndex("source_records_org_dedupe_hash_uq")
      .on(t.organizationId, t.dedupeHash)
      .where(sql`${t.dedupeHash} is not null`),
    check(
      "source_records_identity_check",
      sql`${t.externalId} is not null or ${t.dedupeHash} is not null`
    ),
    check("source_records_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
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
    // "Is this entry already confirmed by a bank line?" (bill payments).
    index("source_records_org_entry_idx")
      .on(t.organizationId, t.journalEntryId)
      .where(sql`${t.journalEntryId} is not null`),
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
    /** GST split behind the proposal (InboxGstSplit, amounts as paise strings). */
    gst: jsonb(),
    /** TDS deducted (InboxTds, amount as a paise string). */
    tds: jsonb(),
    /** Review flags on an extracted bill (BillReview), shown to the reviewer. */
    reviewFlags: jsonb(),
    sourceType: inboxSourceType().notNull(),
    sourceId: uuid().notNull(),
    status: inboxStatus().notNull().default("pending"),
    reviewedBy: text().references(() => user.id, { onDelete: "restrict" }),
    reviewedAt: timestamp({ withTimezone: true }),
    reviewNote: text(),
    postedEntryId: uuid(),
    /** The invoice a receipt pays; approval applies it to the invoice. */
    invoiceId: uuid(),
    /**
     * Refunds only: the invoice the refund is for, so the inbox can offer
     * "create credit note". Approval never applies it as a receipt.
     */
    refundInvoiceId: uuid(),
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
    foreignKey({
      name: "inbox_items_invoice_fk",
      columns: [t.organizationId, t.invoiceId],
      foreignColumns: [invoices.organizationId, invoices.id],
    }),
    foreignKey({
      name: "inbox_items_refund_invoice_fk",
      columns: [t.organizationId, t.refundInvoiceId],
      foreignColumns: [invoices.organizationId, invoices.id],
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
    /**
     * The customer as printed when issued (Rule 46/53): later edits to the
     * party don't change an issued document, its PDF or GSTR-1.
     */
    partyName: text().notNull(),
    partyGstin: text(),
    partyAddress: text(),
    partyStateCode: text(),
    invoiceDate: isoDate().notNull(),
    dueDate: isoDate().notNull(),
    /** Two-digit GST state code of the place of supply. */
    placeOfSupply: text().notNull(),
    supplyType: supplyType().notNull(),
    /** Recipient pays the GST; the invoice charges none. */
    reverseCharge: boolean().notNull().default(false),
    taxablePaise: paise().notNull(),
    cgstPaise: paise().notNull(),
    sgstPaise: paise().notNull(),
    igstPaise: paise().notNull(),
    /** Rounds the total to the rupee: -50 to +50 paise, posted to Round-off. */
    roundOffPaise: paise()
      .notNull()
      .default(sql`0`),
    totalPaise: paise().notNull(),
    paidPaise: paise()
      .notNull()
      .default(sql`0`),
    /** Sum of credit notes against this invoice. */
    creditedPaise: paise()
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
    unique("invoices_org_fy_number_uq").on(
      t.organizationId,
      t.financialYear,
      t.number
    ),
    index("invoices_org_date_idx").on(t.organizationId, t.invoiceDate, t.id),
    // Receipts quote an invoice number without its financial year.
    index("invoices_org_number_idx").on(t.organizationId, t.number),
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
      sql`${t.taxablePaise} >= 0 and ${t.cgstPaise} >= 0 and ${t.sgstPaise} >= 0 and ${t.igstPaise} >= 0 and ${t.paidPaise} >= 0 and ${t.roundOffPaise} between -50 and 50 and ${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise} + ${t.roundOffPaise}`
    ),
    // Credit notes never exceed the invoice.
    check(
      "invoices_credited_check",
      sql`${t.creditedPaise} >= 0 and ${t.creditedPaise} <= ${t.totalPaise}`
    ),
    check(
      "invoices_place_of_supply_check",
      sql`${t.placeOfSupply} ~ '^[0-9]{2}$'`
    ),
    // GST rule: at most 16 characters, unique per financial year.
    check(
      "invoices_number_length_check",
      sql`char_length(${t.number}) between 1 and 16`
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
    /** Income account credited; null → the org's default revenue account. */
    revenueAccountId: uuid(),
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
    foreignKey({
      name: "invoice_lines_revenue_account_fk",
      columns: [t.organizationId, t.revenueAccountId],
      foreignColumns: [ledgerAccounts.organizationId, ledgerAccounts.id],
    }),
    check(
      "invoice_lines_amounts_check",
      sql`${t.quantityMilli} > 0 and ${t.unitPricePaise} >= 0 and ${t.gstRateBps} between 0 and 10000 and ${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`
    ),
  ]
)

// ---------------------------------------------------------------------------
// Credit notes (against a sales invoice)

/** Next credit note number per organisation and financial year. */
export const creditNoteSeries = pgTable(
  "credit_note_series",
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
      "credit_note_series_fy_check",
      sql`${t.financialYear} ~ '^[0-9]{4}-[0-9]{2}$'`
    ),
  ]
)

export const creditNotes = pgTable(
  "credit_notes",
  {
    id: id(),
    organizationId: organizationId(),
    number: text().notNull(),
    financialYear: text().notNull(),
    invoiceId: uuid().notNull(),
    partyId: uuid().notNull(),
    /**
     * The customer as printed when issued (Rule 46/53): later edits to the
     * party don't change an issued document, its PDF or GSTR-1.
     */
    partyName: text().notNull(),
    partyGstin: text(),
    partyAddress: text(),
    partyStateCode: text(),
    creditNoteDate: isoDate().notNull(),
    reason: creditNoteReason().notNull(),
    /** Copied from the invoice: a credit note follows its invoice's GST treatment. */
    placeOfSupply: text().notNull(),
    supplyType: supplyType().notNull(),
    reverseCharge: boolean().notNull().default(false),
    taxablePaise: paise().notNull(),
    cgstPaise: paise().notNull(),
    sgstPaise: paise().notNull(),
    igstPaise: paise().notNull(),
    roundOffPaise: paise()
      .notNull()
      .default(sql`0`),
    totalPaise: paise().notNull(),
    /** The Razorpay refund that caused it, if any. */
    sourceRecordId: uuid(),
    notes: text(),
    journalEntryId: uuid(),
    createdBy: text().references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("credit_notes_org_id_uq").on(t.organizationId, t.id),
    unique("credit_notes_org_fy_number_uq").on(
      t.organizationId,
      t.financialYear,
      t.number
    ),
    index("credit_notes_org_date_idx").on(
      t.organizationId,
      t.creditNoteDate,
      t.id
    ),
    index("credit_notes_org_invoice_idx").on(t.organizationId, t.invoiceId),
    uniqueIndex("credit_notes_org_source_record_uq")
      .on(t.organizationId, t.sourceRecordId)
      .where(sql`${t.sourceRecordId} is not null`),
    foreignKey({
      name: "credit_notes_invoice_fk",
      columns: [t.organizationId, t.invoiceId],
      foreignColumns: [invoices.organizationId, invoices.id],
    }),
    foreignKey({
      name: "credit_notes_party_fk",
      columns: [t.organizationId, t.partyId],
      foreignColumns: [parties.organizationId, parties.id],
    }),
    foreignKey({
      name: "credit_notes_source_record_fk",
      columns: [t.organizationId, t.sourceRecordId],
      foreignColumns: [sourceRecords.organizationId, sourceRecords.id],
    }),
    foreignKey({
      name: "credit_notes_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    check(
      "credit_notes_amounts_check",
      sql`${t.taxablePaise} >= 0 and ${t.cgstPaise} >= 0 and ${t.sgstPaise} >= 0 and ${t.igstPaise} >= 0 and ${t.roundOffPaise} between -50 and 50 and ${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise} + ${t.roundOffPaise}`
    ),
    check(
      "credit_notes_number_length_check",
      sql`char_length(${t.number}) between 1 and 16`
    ),
    check(
      "credit_notes_place_of_supply_check",
      sql`${t.placeOfSupply} ~ '^[0-9]{2}$'`
    ),
  ]
)

export const creditNoteLines = pgTable(
  "credit_note_lines",
  {
    id: id(),
    organizationId: organizationId(),
    creditNoteId: uuid().notNull(),
    lineNo: integer().notNull(),
    /** The invoice line being credited, when it maps to one. */
    invoiceLineId: uuid(),
    description: text().notNull(),
    hsnSac: text().notNull(),
    quantityMilli: bigint({ mode: "bigint" }).notNull(),
    unitPricePaise: paise().notNull(),
    gstRateBps: integer().notNull(),
    taxablePaise: paise().notNull(),
    cgstPaise: paise().notNull(),
    sgstPaise: paise().notNull(),
    igstPaise: paise().notNull(),
    totalPaise: paise().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("credit_note_lines_org_note_line_uq").on(
      t.organizationId,
      t.creditNoteId,
      t.lineNo
    ),
    foreignKey({
      name: "credit_note_lines_note_fk",
      columns: [t.organizationId, t.creditNoteId],
      foreignColumns: [creditNotes.organizationId, creditNotes.id],
    }),
    // What's already been credited on each invoice line.
    index("credit_note_lines_org_invoice_line_idx").on(
      t.organizationId,
      t.invoiceLineId
    ),
    check(
      "credit_note_lines_amounts_check",
      // quantity 0: credited by value (a discount or correction), no units.
      sql`${t.quantityMilli} >= 0 and ${t.unitPricePaise} >= 0 and ${t.gstRateBps} between 0 and 10000 and ${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`
    ),
  ]
)

// ---------------------------------------------------------------------------
// Consent and data rights

/** A user accepting a version of the data-processing consent for an org. */
export const consents = pgTable(
  "consents",
  {
    id: id(),
    organizationId: organizationId(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    consentVersion: text().notNull(),
    acceptedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("consents_org_user_version_uq").on(
      t.organizationId,
      t.userId,
      t.consentVersion
    ),
    index("consents_org_version_accepted_idx").on(
      t.organizationId,
      t.consentVersion,
      t.acceptedAt
    ),
  ]
)

/**
 * Record of an organisation's data deletion. Deliberately has no foreign key
 * to `organization`, so it survives the deletion it describes.
 */
export const deletionTombstones = pgTable(
  "deletion_tombstones",
  {
    id: id(),
    organizationId: text().notNull(),
    organizationName: text().notNull(),
    /** User id at request time (the user row may be gone later). */
    requestedBy: text().notNull(),
    requestedAt: timestamp({ withTimezone: true }).notNull(),
    deletedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** What was removed immediately, with row counts per table. */
    deleted: jsonb().notNull(),
    /** What was kept read-only for legal retention. */
    retained: jsonb().notNull(),
    /** 8 years from the end of the last financial year with books. */
    retentionUntil: isoDate().notNull(),
    purgedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("deletion_tombstones_org_idx").on(t.organizationId),
    index("deletion_tombstones_retention_idx")
      .on(t.retentionUntil)
      .where(sql`${t.purgedAt} is null`),
  ]
)

// ---------------------------------------------------------------------------
// Bills (payables). A bill is created when a vendor bill's inbox item is
// approved; payments and advance adjustments are allocations against it.

export const billAllocationKind = pgEnum("bill_allocation_kind", [
  "payment",
  "advance",
])

export const bills = pgTable(
  "bills",
  {
    id: id(),
    organizationId: organizationId(),
    partyId: uuid().notNull(),
    /** The vendor's own bill number. */
    number: text().notNull(),
    billDate: isoDate().notNull(),
    dueDate: isoDate().notNull(),
    /** Owed to the vendor: the bill's credit to trade payables. */
    totalPaise: paise().notNull(),
    /** Paid or adjusted from advances so far. */
    settledPaise: paise()
      .notNull()
      .default(sql`0`),
    journalEntryId: uuid().notNull(),
    inboxItemId: uuid(),
    documentId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("bills_org_id_uq").on(t.organizationId, t.id),
    unique("bills_org_entry_uq").on(t.organizationId, t.journalEntryId),
    foreignKey({
      name: "bills_party_fk",
      columns: [t.organizationId, t.partyId],
      foreignColumns: [parties.organizationId, parties.id],
    }),
    foreignKey({
      name: "bills_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    index("bills_org_party_date_idx").on(
      t.organizationId,
      t.partyId,
      t.billDate,
      t.id
    ),
    index("bills_org_date_idx").on(t.organizationId, t.billDate, t.id),
    check(
      "bills_amounts_check",
      sql`${t.totalPaise} > 0 and ${t.settledPaise} between 0 and ${t.totalPaise}`
    ),
  ]
)

export const billAllocations = pgTable(
  "bill_allocations",
  {
    id: id(),
    organizationId: organizationId(),
    billId: uuid().notNull(),
    kind: billAllocationKind().notNull(),
    /** The payment or advance-adjustment entry. */
    journalEntryId: uuid().notNull(),
    amountPaise: paise().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "bill_allocations_bill_fk",
      columns: [t.organizationId, t.billId],
      foreignColumns: [bills.organizationId, bills.id],
    }),
    foreignKey({
      name: "bill_allocations_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    index("bill_allocations_org_bill_idx").on(t.organizationId, t.billId),
    check("bill_allocations_amount_check", sql`${t.amountPaise} > 0`),
  ]
)

// ---------------------------------------------------------------------------
// Ask Median (chat). Private to the member who started the conversation.

export const chatRole = pgEnum("chat_role", [
  "user",
  "assistant",
  "tool",
  "system",
])

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    organizationId: organizationId(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Null until set, or until the first question names it. */
    title: text(),
    /** The page the chat was opened from: { path, label?, entity? }. */
    pageContext: jsonb(),
    createdAt: createdAt(),
    /** Bumped on every message, so lists show the latest first. */
    lastMessageAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("conversations_org_id_uq").on(t.organizationId, t.id),
    index("conversations_org_user_recent_idx").on(
      t.organizationId,
      t.userId,
      t.lastMessageAt,
      t.id
    ),
  ]
)

export const messages = pgTable(
  "messages",
  {
    id: id(),
    organizationId: organizationId(),
    conversationId: uuid().notNull(),
    role: chatRole().notNull(),
    content: text().notNull(),
    /** Assistant messages: the tools it called, [{ id, name, args }]. */
    toolCalls: jsonb(),
    /** Tool messages: which call this is the result of. */
    toolCallId: text(),
    // clock_timestamp, not now(): each message gets its own instant, so
    // order is stable even for messages saved in quick succession.
    createdAt: timestamp({ withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({
      name: "messages_conversation_fk",
      columns: [t.organizationId, t.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
    }).onDelete("cascade"),
    index("messages_org_conversation_created_idx").on(
      t.organizationId,
      t.conversationId,
      t.createdAt,
      t.id
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

export const creditNotesRelations = relations(creditNotes, ({ one, many }) => ({
  invoice: one(invoices, {
    fields: [creditNotes.invoiceId],
    references: [invoices.id],
  }),
  party: one(parties, {
    fields: [creditNotes.partyId],
    references: [parties.id],
  }),
  lines: many(creditNoteLines),
}))

export const creditNoteLinesRelations = relations(
  creditNoteLines,
  ({ one }) => ({
    creditNote: one(creditNotes, {
      fields: [creditNoteLines.creditNoteId],
      references: [creditNotes.id],
    }),
  })
)
