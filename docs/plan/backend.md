You are the backend engineer's Claude Code for **Median**, an AI-native revenue and ledger platform for Indian startups (Tally replacement). Two people build in parallel this week:

- **Backend (you):** ledger, database, integrations, services, reports, GST maths, Tally export.
- **App + AI (Ayush):** design system, pages, components, AI extraction, AI inbox UI, invoice PDFs.

Goal: a working MVP live with 3–5 design-partner startups by Day 7.

## First time only
1. Read CLAUDE.md and follow every rule in it (integer paise, append-only ledger, no `any`, AI never does maths, organization_id on every query, performance rules).
2. Save this whole prompt to `docs/plan/backend.md` in a PR named "docs: backend plan" so later sessions can read it.
3. On later days the user will say "Today is Day N". Read `docs/plan/backend.md`, do only Day N's tasks, in order.

## Ownership rules
- You own: `packages/ledger`, `apps/web/src/server/db`, `apps/web/src/server/integrations`, `apps/web/src/server/services`, `apps/web/src/server/reports`.
- You are the **only** person who generates Drizzle migrations.
- Never edit Ayush's folders (`packages/ui`, `apps/web/src/app` pages, `apps/web/src/components`, `apps/web/src/server/ai`). If you need something there, stop and write the request in your end-of-day summary.
- If you need a new dependency, add it in its own small PR.
- One branch and one PR per slice. Branch names: `be/<slice>`. Pull main before starting and before opening a PR. `npm run lint && npm run typecheck && npm test && npm run build` must pass before every PR.
- Use the `dev-backend` Neon branch for development.

## The shared contract (Day 1, merge by noon — Ayush builds against it)

### Tables (all business tables have `organization_id`, `created_at`; money columns are `bigint` paise)
- Better Auth tables (generate with the Better Auth CLI, organization plugin)
- `ledger_accounts`: code, name, type (asset | liability | equity | income | expense), parent_id, is_system
- `parties`: kind (customer | vendor), name, gstin, state_code, email, phone
- `journal_entries`: entry_date, narration, source_type, source_id, reverses_entry_id, created_by
- `journal_lines`: entry_id, account_id, party_id, debit_paise, credit_paise, dimensions (jsonb)
- `period_locks`: period (YYYY-MM), locked_by, locked_at
- `audit_log`: actor_id, action, entity, entity_id, before (jsonb), after (jsonb), source, at
- `connections`: provider (razorpay | bank), encrypted credentials, status, last_synced_at
- `source_records`: connection_id, provider, external_id (unique per org+provider), kind (payment | refund | fee | settlement | payout | bank_line), amount_paise, occurred_at, payload (jsonb)
- `documents`: kind (bill | bank_statement), blob_url, status, extracted (jsonb)
- `inbox_items`: kind, proposed_entry (jsonb), confidence (0–1), reason, source_ref, status (pending | approved | rejected), reviewed_by, reviewed_at
- `invoices` + `invoice_lines`: number (series per financial year), party_id, invoice_date, place_of_supply, hsn_sac, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, supply_type (intrastate | interstate | export_with_payment | export_lut | sez), reverse_charge (bool)
- `credit_notes` + `credit_note_lines`: series per financial year, linked to the original invoice
- Organisation GST profile: gstin, state_code, gst_registered (bool), composition_scheme (bool), default_gst_rate_bps
- Product/stream → GST rate mapping table
- Seeded ledger accounts include Output CGST/SGST/IGST, Input CGST/SGST/IGST, TDS receivable, Gateway charges, Razorpay clearing, Round-off

Index every query path, `organization_id` first.

### Service functions in `apps/web/src/server/services` (typed inputs and outputs, Zod at boundaries)
- `getDashboardSummary(orgId)` → cash, revenue this month vs last, receivables due, GST payable, inbox count
- `listInboxItems(orgId, cursor)`, `approveInboxItem(orgId, id, edits?)`, `rejectInboxItem(orgId, id, reason)`
- `createInboxItemFromExtraction(orgId, documentId, extraction)` — Ayush's AI calls this
- `connectRazorpay(orgId, keyId, keySecret)`, `syncRazorpay(orgId)`
- `importBankRows(orgId, rows)` → matching results
- `createInvoice(orgId, input)`, `getInvoice(orgId, id)`, `listInvoices(orgId, cursor)`
- `getProfitAndLoss(orgId, from, to)`, `getBalanceSheet(orgId, asOf)`, `getTrialBalance(orgId, asOf)`, `listEntries(orgId, filters, cursor)`
- `getGstSummary(orgId, period)`, `exportTally(orgId, from, to)`, `lockPeriod(orgId, period)`, `listAuditLog(orgId, cursor)`

**Stubs:** every function first returns realistic fake data with the final types, so Ayush's screens work before the real logic exists. Replace stubs one by one through the week without changing signatures. If a signature must change, note it in the summary.

## Accounting rules

These rules are part of the plan. Every rule gets tests in `packages/ledger` or in the relevant service. Any rule not finished on its day goes in that day's end-of-day summary.

**GST profile and rates**
- Each organisation has a GST profile: `gstin`, `state_code`, `gst_registered` (bool), `composition_scheme` (bool), `default_gst_rate_bps`.
- A product/stream → GST rate mapping table gives the rate for things sold without an invoice.

**Ledger**
- Posting directly into a locked period is rejected.
- Reversing an entry that sits in a locked period posts the reversal in the current open period, linked via `reverses_entry_id`, with an audit row.

**Razorpay**
- Payments without an invoice are GST-inclusive. Rate resolution, in order: invoice/order lines → product mapping → org default rate → otherwise an inbox item. If `gst_registered` is false, there is no split.
- Split in integer paise: `taxable = round(amount × 100 / (100 + rate))`, `gst = amount − taxable`. Intrastate → CGST + SGST halves (the odd paisa is assigned deterministically); interstate → IGST.
- Fees: use Razorpay's `fee` and `tax` fields as given; book gateway charges + input GST. Never compute 18% ourselves.
- Use Razorpay's settlement reconciliation endpoint to map settlements to payments, fees and refunds when the account has access; otherwise fall back to inference and flag it.
- Refund of an invoiced sale → credit note (reduces output GST). Refund without an invoice → reversal.

**Bank matching**
- Dedupe key = hash(account, date, amount, narration, running balance). If the balance is missing, add an occurrence index for identical (account, date, amount, narration) rows. Uploading the same or overlapping statements twice creates no duplicates. Test both.
- Receipt matching accepts amount = invoice total − TDS, where TDS = rate × taxable value for rates 1%, 2% and 10%. Book TDS receivable and the section; these go to the inbox until approved.

**Invoices and credit notes**
- Supply type comes from place of supply vs the org's `state_code`; export, SEZ and reverse-charge flags are respected (zero-rated or no GST charged, as applicable).
- GST is computed per line in paise; the invoice total is rounded to the rupee and the difference goes to Round-off.
- Invoice numbers are unique per financial year (April–March) and at most 16 characters. Credit notes have their own series per financial year.

## Day-by-day tasks

**Day 1: contract and ledger**
1. Contract PR (by noon): Better Auth tables, all tables above, migration, service signatures with stubs. Ping-worthy: tell the user when it's merged.
2. Chart-of-accounts template for startups (SaaS, D2C, agency), seeded when an org is created.
3. `packages/ledger`: `postEntry` rules — balanced, integer paise, no posting into a locked period, corrections only by reversal. Tests for each.
   - Posting directly into a locked period is rejected. Test it.
   - Reversal of an entry in a locked period posts in the current open period, linked via `reverses_entry_id`, with an audit row. Test it.
4. Real `postEntry` service: writes entry + lines + audit_log in one transaction.

**Day 2: Razorpay**
1. `connectRazorpay`: verify keys with a test call, store encrypted.
2. `syncRazorpay`: payments, refunds, settlements and fees into `source_records`, idempotent by external_id, paginated, safe to re-run.
3. Deterministic rules turn records into entries: payment → receivable/revenue, fee → gateway charges with GST, refund → reversal, settlement → bank (clearing) account. High-confidence rule matches post directly; anything else becomes an inbox item.
   - Payments without an invoice are GST-inclusive: rate from invoice/order lines → product mapping → org default rate → else inbox item. No split if `gst_registered` is false. Split in integer paise (`taxable = round(amount × 100 / (100 + rate))`, `gst = amount − taxable`); intrastate CGST+SGST halves with the odd paisa assigned deterministically, interstate IGST.
   - Fees: Razorpay's `fee` and `tax` fields as given → gateway charges + input GST. Never compute 18%.
   - Refund of an invoiced sale → credit note (reduces output GST); refund without invoice → reversal.
4. Settlement matching: each settlement ties to its payments, fees and refunds; flag gaps.
   - Use Razorpay's settlement reconciliation endpoint when the account has access; otherwise infer and flag it.

**Day 3: bank and matching**
1. `importBankRows`: accepts normalised rows (CSV parsed with papaparse server-side; PDF rows come from Ayush's AI module in the same shape).
   - Dedupe key = hash(account, date, amount, narration, running balance); with no balance, add an occurrence index for identical (account, date, amount, narration) rows. Same or overlapping statements uploaded twice create no duplicates. Test both.
2. Matching engine, deterministic: settlement credits, invoice payments, known vendors; amount + date window + reference. Unmatched lines → inbox items.
   - Receipts may equal invoice total − TDS (TDS = rate × taxable value, rates 1%, 2%, 10%). Book TDS receivable and the section; send to the inbox until approved.
3. Real `listInboxItems`, `approveInboxItem`, `rejectInboxItem` (approve posts the proposed entry through `postEntry`).

**Day 4: invoices and bills**
1. `createInvoice`: number series per financial year, CGST+SGST vs IGST from place of supply, posts to ledger.
   - Supply type from place of supply vs org `state_code`; export, SEZ and reverse-charge flags respected (zero-rated or no GST charged as applicable).
   - GST per line in paise; invoice total rounded to the rupee, difference to Round-off.
   - Invoice number unique per financial year (April–March), max 16 characters.
   - Credit notes: own series per financial year; used for refunds of invoiced sales.
2. Parties: create, list, find by GSTIN.
3. `createInboxItemFromExtraction`: validate the AI's extraction with Zod, compute tax and totals in code, propose a purchase entry with input tax credit.

**Day 5: reports**
1. Trial balance, P&L, balance sheet (Schedule III-style grouping), `listEntries` with drill-down.
2. Real `getDashboardSummary`.
3. Performance pass: EXPLAIN every report query, add missing indexes, no N+1, cursor pagination.

**Day 6: GST, CA tools, export**
1. `getGstSummary`: outward supplies by rate, input tax credit, net payable, in a 3B-style sheet.
   - Include credit notes, TDS receivable totals, and separate rows for exports, SEZ and reverse charge.
2. `exportTally`: Tally-importable XML (masters and vouchers) for a period. Validate the XML is well-formed.
3. `lockPeriod`, real `listAuditLog`, full CSV data export.

**Day 7: launch**
1. Seed a demo org with a month of realistic fake data.
2. Load one friendly startup's real data (Razorpay test or live read-only keys, bank CSV), fix every bug found.
3. Production env vars, production Neon branch, migrations applied. Note anything still missing for the daily India backup rule.

## End of every day
Print a summary for the user to paste to their advisor, in this format:
- Day N — done / not done (per task, including each accounting rule for that day)
- PRs merged
- Contract changes (signatures, tables) Ayush must know about
- Requests for Ayush's side
- Bugs or risks found
- What's first tomorrow
