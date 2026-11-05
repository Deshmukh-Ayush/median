# Median — backend plan v2

This replaces docs/plan/backend.md entirely. Decisions made: merge order A (merge the Day 1 PRs to main first, then build v2 on top — no stacked PRs); deletion option A (delete everything except the books; books kept read-only for the legal retention period). Signatures use the existing `ctx` convention.

You are the backend engineer's Claude Code for **Median**, an AI-native revenue and ledger platform for Indian businesses (Tally replacement). Two people build in parallel:
- **Backend (you):** ledger, database, contracts, integrations, services, reports, GST, exports.
- **App + AI (Ayush):** design system, pages, components, AI extraction, AI inbox UI, invoice PDFs.

Goal: a working MVP live with 3–5 design-partner startups by Day 7.

## How to use this plan
- Read CLAUDE.md and follow it. Then read this file. When the user says "Today is Day N", do only Day N's tasks, in order.
- Accounting rules live only in the "Accounting rules" section below. Day tasks refer to them; never restate them differently.

## Ownership
- You own: `packages/ledger`, `packages/contracts`, `apps/web/src/server/db`, `src/server/integrations`, `src/server/services`, `src/server/reports`, plus `apps/web/drizzle/` (migrations) and `apps/web/src/server/auth/index.ts` (org-creation hooks), as agreed in #10.
- You are the only person who generates Drizzle migrations.
- Never edit Ayush's folders (`packages/ui`, `apps/web/src/app` pages, `src/components`, `src/server/ai`, `src/lib`). Write requests in your end-of-day summary.
- `packages/contracts` holds every shared type and Zod schema. It never imports Next.js, the database or AI code. Every change is a small PR whose description lists each changed type or signature.
- One branch and PR per slice (`be/<slice>`), never stacked. Before each branch: `gh repo sync VedantGhodki006/median`, then `git pull` on the fork's main, and start the branch from it. PRs go from the fork to `Deshmukh-Ayush/median` main. Pull main again before opening a PR. Lint, typecheck, test and build must pass.
- Dev database: the `dev-backend` Neon branch.

## Accounting rules (apply everywhere)
1. **Money:** integer paise only (bigint). No floats anywhere in calculation or storage.
2. **Append-only ledger:** posted entries and lines are never updated or deleted; a DB trigger enforces it. Corrections are reversal entries.
3. **Locked periods:** nothing posts into a locked period. A reversal of an entry in a locked period posts in the current open period, linked by `reverses_entry_id`, with an audit row.
4. **Audit:** every change to the books writes an audit row (who, what, when, source) in the same transaction.
5. **Financial year:** April–March. Invoice and credit-note numbers are unique per financial year, max 16 characters.
6. **Supply type:** compare place of supply with the org's state code. Same state → CGST + SGST (split in half; the odd paisa goes to CGST). Different state → IGST. Flags respected: export with payment, export under LUT (zero-rated), SEZ, reverse charge. Business rule for unknown B2C place of supply: use the org's state.
7. **Rounding:** GST computed per line in paise; invoice total rounded to the nearest rupee; the difference posts to Round-off.
8. **GST-inclusive amounts** (payments with no invoice): rate from invoice/order lines → product/stream mapping → org default rate → otherwise an inbox item. If the org is not GST-registered, no split. taxable = round(amount × 100 / (100 + rate)); gst = amount − taxable.
9. **Gateway fees:** use the fee and tax fields the provider returns; book gateway charges plus input GST. Never compute 18% yourself.
10. **Refunds:** refund of an invoiced sale → credit note (reduces output GST, appears in GSTR-1). Refund with no invoice → reversal.
11. **TDS on receipts:** expected receipt = invoice total − (TDS rate × taxable value), trying 1%, 2% and 10%. Book TDS receivable with the section. These go to the inbox until approved.
12. **Bank dedupe:** key = hash(account, date, amount, narration, running balance). If balance is missing, add an occurrence index for identical (account, date, amount, narration) rows. Re-uploading the same or overlapping statements creates no duplicates.
13. **AI never does maths:** AI output is validated with Zod; all tax and totals are recomputed in code; AI-proposed entries go to the inbox.
14. **Tenancy:** every business table has `organization_id`; every query is scoped by it.

## Contract (Day 1)

### packages/contracts
All shared types and Zod schemas: money, org GST profile, service inputs and outputs, SourceRecord, inbox items, invoices, credit notes, reports, consent, errors (including `CONSENT_REQUIRED`).

### Tables (all with `organization_id`, `created_at`; money as bigint paise)
- Better Auth tables (organization plugin)
- `organization_settings`: gstin, state_code, gst_registered, composition_scheme, default_gst_rate_bps, business_type (saas | d2c | agency)
- `gst_rate_mappings`: product or stream → rate_bps
- `ledger_accounts`: code, name, type, parent_id, is_system. Seeded per org: Output CGST/SGST/IGST, Input CGST/SGST/IGST, TDS receivable, Gateway charges, Razorpay clearing, Round-off, plus the startup chart of accounts template
- `parties`: kind, name, gstin, state_code, email, phone
- `journal_entries`: entry_date, narration, source_type, source_id, reverses_entry_id, created_by
- `journal_lines`: entry_id, account_id, party_id, debit_paise, credit_paise, dimensions (jsonb)
- `period_locks`, `audit_log`
- `connections`: provider, auth_type, encrypted credentials, status (connected | syncing | error | disconnected), cursor, last_synced_at, last_error
- `source_records`: connection_id, provider, kind, external_id or dedupe_hash, occurred_at, amount_paise, currency, payload. Unique (organization_id, provider, external_id) and (organization_id, dedupe_hash)
- `documents`, `inbox_items`
- `invoices` + `invoice_lines` (supply_type, reverse_charge, place_of_supply, hsn_sac, per-line rate, taxable/cgst/sgst/igst paise, round_off_paise)
- `credit_notes` + `credit_note_lines` (linked to invoice)
- `consents`: user_id, consent_version, accepted_at
- `deletion_tombstones` (not scoped to a live org, survives deletion): org id, requested_by, deleted_at, what was deleted, retention_until

DB guards in the migration: triggers blocking UPDATE and DELETE on journal_entries, journal_lines and audit_log; the unique constraints above. Index every query path, organization_id first.

### Services (in `src/server/services`, typed via packages/contracts, `ctx` carries org and user)
- Dashboard and inbox: `getDashboardSummary`, `listInboxItems`, `approveInboxItem`, `rejectInboxItem`, `createInboxItemFromExtraction`
- Connectors: `listConnectors`, `listConnections`, `connect`, `disconnect`, `syncConnection`, `importFile`
- Invoices: `createInvoice`, `getInvoice`, `listInvoices`, `createCreditNote`
- Reports: `getProfitAndLoss`, `getBalanceSheet`, `getTrialBalance`, `listEntries`
- GST and CA: `getGstSummary`, `exportGstr1(ctx, period)` → { period, gstin, payload, warnings }, `exportTally`, `lockPeriod`, `listAuditLog`
- Consent: `recordConsent(ctx, consentVersion)` (user from session), `getConsentStatus(ctx)` → { currentVersion, accepted, acceptedAt, acceptedBy }
- Data rights: `exportOrgData(ctx)` → zip of one CSV per table plus a JSON manifest; `deleteOrgData(ctx, { confirmation })`, two steps (request → token + summary; confirm with token + typed org name), owner only
- **Consent gate:** `connect`, `syncConnection`, `importFile` and `createInboxItemFromExtraction` throw `CONSENT_REQUIRED` until consent is recorded.

Every service first ships as a stub returning realistic fake data with final types. Replace stubs during the week without changing signatures; list any change in the PR and the summary.

## Day-by-day tasks

**Day 1: contract and ledger**
1. Merge order A: get the open Day 1 PRs merged to main first.
2. Contract PR (target: by noon): packages/contracts, all tables and DB guards, migration, every service as a stub. Tell the user when it's merged so Ayush can switch to packages/contracts.
3. Startup chart-of-accounts templates (SaaS, D2C, agency), seeded on org creation with the system accounts above.
4. packages/ledger: `postEntry` rules 1–4 with tests, including the locked-period reversal test and a test that direct posting into a locked period is rejected.
5. Real `postEntry` service: entry + lines + audit row in one transaction.

**Day 2: connector framework, then Razorpay**
1. `src/server/integrations/connector.ts`: one interface — provider, displayName, authType (api_key | oauth | file), testConnection, sync(ctx, connectionId, cursor) → SourceRecords + next cursor, parseFile for file connectors. Registry in `registry.ts`; a new connector = one folder + one registry line.
2. Sync runner: idempotent upsert into source_records, saves cursor and status, manual sync plus a scheduled sync (check Vercel Hobby cron limits; fall back to daily). Credentials encrypted, never logged.
3. Posting rules run on SourceRecords (rules 8–11), so every connector gets them.
4. `integrations/razorpay/`: API key auth (OAuth after partner approval), payments, refunds, fees, settlements. Use the settlement reconciliation endpoint if available; otherwise infer and flag. High-confidence rule matches post; everything else goes to the inbox.
5. Real `listConnectors`, `listConnections`, `connect`, `disconnect`, `syncConnection`, with the consent gate.

**Day 3: bank statements and the inbox**
1. `integrations/bank-statement/` as a file connector: CSV parsed with papaparse server-side; PDF rows arrive from Ayush's AI module in the same shape. Dedupe per rule 12, with tests for re-upload and overlapping statements.
2. Deterministic matching: settlement credits, invoice receipts (with TDS per rule 11), known vendors; amount + date window + reference. Unmatched lines → inbox.
3. Real `listInboxItems`, `approveInboxItem` (posts through postEntry), `rejectInboxItem`, `importFile`.

**Day 4: invoices, credit notes, bills**
1. `createInvoice` per rules 5–7; parties create, list, find by GSTIN.
2. `createCreditNote` linked to an invoice; refunds of invoiced sales use it (rule 10).
3. `createInboxItemFromExtraction`: validate with Zod, recompute tax and totals in code, propose a purchase entry with input tax credit; consent gate.

**Day 5: reports**
1. Trial balance, P&L, balance sheet (Schedule III-style grouping), `listEntries` with drill-down; real `getDashboardSummary`.
2. Performance pass: EXPLAIN every report query, add indexes, no N+1, cursor pagination.

**Day 6: GST, CA tools, migration**
1. `getGstSummary`: outward supplies by rate, credit notes, input tax credit, TDS receivable, separate rows for exports, SEZ and reverse charge, net payable.
2. `exportGstr1`: draft JSON (b2b, b2cl, b2cs, cdnr, hsn, doc_issue), validated against a Zod schema of the GSTN offline-tool format; warnings for missing GSTIN or HSN; requires org GSTIN. Marked as a draft the CA verifies in the offline tool before filing.
3. `exportTally` (well-formed, Tally-importable XML) and `integrations/tally-import/` as a file connector: parties, accounts mapped to our chart, opening balances, past vouchers. After import, our trial balance must equal the source's; report any difference.
4. `lockPeriod`, real `listAuditLog`.
5. Consent and data rights: `recordConsent`, `getConsentStatus`, `exportOrgData`, `deleteOrgData` per option A — immediately remove credentials, documents and raw payloads, members and personal contact details; keep ledger, invoices, credit notes and audit log read-only until retention_until (8 years from the end of the financial year), then purge; write a deletion_tombstones row.

**Day 7: launch**
1. Hard check: production AI must use a paid provider (Gemini with billing enabled, or Vercel AI Gateway / OpenRouter). Block real-data import if the free-tier key is configured in production.
2. Seed a demo org with a month of realistic fake data.
3. With written consent recorded, load one friendly startup's real data; fix every bug found.
4. Production env vars, production Neon branch, migrations applied. Report the region where data is stored and what's still missing for the daily India backup rule.

## Week 2 (plan only, don't build)
Zoho Books import, GSTR-2B reconciliation, Stripe, Cashfree, Shopify, email forwarding of bills and statements, email and Slack alerts, WhatsApp, collections agent, eve agents, the daily India backup job.

## End of every day
Print a summary for the user to paste to their advisor:
- Day N: done / not done, per task
- PRs merged
- Contract changes Ayush must know about (type and signature level)
- Requests for Ayush's side
- Bugs or risks found
- What's first tomorrow
