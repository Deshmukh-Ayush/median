You are Ayush's Claude Code for **Median**, an AI-native revenue and ledger platform for Indian startups (Tally replacement). Two people build in parallel this week:

- **App + AI (you):** design system, pages, components, AI extraction, AI inbox UI, invoice PDFs.
- **Backend (teammate):** ledger, database, integrations, services, reports, GST maths, Tally export.

Goal: a working MVP live with 3–5 design-partner startups by Day 7.

## First time only
1. Read CLAUDE.md and follow every rule in it (no `any`, integer paise, AI never does maths, Server Components by default, minimal client JS, all AI calls through `src/server/ai/models.ts`, Gemini free tier with test data only).
2. Save this whole prompt to `docs/plan/app.md` in a PR named "docs: app plan" so later sessions can read it.
3. On later days the user will say "Today is Day N". Read `docs/plan/app.md`, do only Day N's tasks, in order.

## Ownership rules
- You own: `packages/ui`, `apps/web/src/app` (pages and route handlers that only call services), `apps/web/src/components`, `apps/web/src/server/ai`, `apps/web/src/lib` (formatting and client utilities).
- Never edit the backend's folders (`packages/ledger`, `packages/contracts`, `apps/web/src/server/db`, `src/server/integrations`, `src/server/services`, `src/server/reports`) and never generate migrations. The backend also owns `apps/web/drizzle/` (migrations) and `apps/web/src/server/auth/index.ts` (org-creation hooks). Pages get data only by calling functions in `src/server/services`. If you need a new field or function, stop and write the request in your end-of-day summary.
- If you need a new dependency, add it in its own small PR.
- Shared types and Zod schemas live in `packages/contracts` (the backend is adding it). Once it's on main, import every shared type and Zod schema from it. Never copy or redefine them in `apps/web`, and replace any local duplicates with imports from `packages/contracts`.
- One branch and one PR per slice. Branch names: `app/<slice>`. Pull main before starting and before opening a PR. `npm run lint && npm run typecheck && npm test && npm run build` must pass before every PR.
- Use the `dev-app` Neon branch for development.

## What the backend provides (the contract, merged by Day 1 noon)
Service functions in `apps/web/src/server/services`, first as stubs returning realistic fake data with final types, replaced by real logic during the week without signature changes:
- `getDashboardSummary`, `listInboxItems`, `approveInboxItem`, `rejectInboxItem`, `createInboxItemFromExtraction`
- `connectRazorpay`, `syncRazorpay`, `importBankRows`
- `createInvoice`, `getInvoice`, `listInvoices`
- `getProfitAndLoss`, `getBalanceSheet`, `getTrialBalance`, `listEntries`
- `getGstSummary`, `exportTally`, `lockPeriod`, `listAuditLog`
Read their types from the code once merged; don't guess.

## Design principles
- Founder language first: "Money in", "Money owed to you", "Tax due". Debits and credits only in the Ledger view and CA screens.
- Every number clicks through to the entries behind it.
- One queue for all work: the AI inbox, ranked by impact.
- Calm and clean: light and dark, generous white space, one accent colour, Indian format (₹1,23,45,678) with a lakh/crore toggle.
- Fast: Ctrl+K command bar, keyboard shortcuts, skeletons and Suspense for slow parts, no layout shift.

## Day-by-day tasks

**Day 1: shell and auth** (morning doesn't need the contract)
1. Design tokens on the Base UI Nova preset: one accent colour, type scale, spacing, light/dark.
2. `formatINR` and lakh/crore helpers in `src/lib`, with tests.
3. Sign up, sign in, create organization (pick business type: SaaS, D2C, agency), invite member, role-aware navigation using `permissions.ts`.
   - Org onboarding also collects GSTIN, state, GST registered (yes/no), composition scheme (yes/no) and default GST rate.
4. App shell: sidebar with Home, AI inbox, Revenue, Cash, Invoices, Bills, GST, Reports, Ledger, Settings; Ctrl+K command bar.
5. After the contract merges: Home screen wired to `getDashboardSummary` (stub data is fine).

**Day 2: AI extraction and connections**
1. In `src/server/ai`: Zod schemas for bill extraction (vendor, GSTIN, invoice number, date, line items, HSN/SAC, taxable value, tax rates as printed) using `generateObject` with `fastModel`. The AI extracts; it never computes totals.
2. An eval script: run 30 sample bills (fake or anonymised) and report field-level accuracy. Save results to `docs/evals/`.
3. Settings → Integrations: a gallery from `listConnectors()`, grouped by category (Payments, Banks, Accounting, Sales channels, Payroll). Each card shows status, last synced, sync now and disconnect. Connectors not built yet show "Coming soon". The connect flow depends on each connector's `authType`: an API key form, a file upload, or OAuth.
   - Razorpay connects by OAuth redirect: "Connect Razorpay" → Razorpay's approval screen → back to Settings → Integrations. The card shows one of three statuses: connected, reconnect needed, or revoked (reconnect needed and revoked show a "Reconnect" button). The Razorpay API-key form is shown only in test mode.
   - Until Razorpay partner approval comes through, the Integrations screen also offers "Upload Razorpay settlement report": a file import through the same file-connector flow as bank statements.
4. Settings → GST rates: map each product/stream to a GST rate (the default per-line rate in the invoice builder).

**Day 3: AI inbox and bank upload**
1. AI inbox: cursor-paginated list, detail panel with the source document, confidence and reason, approve / edit / reject, bulk approve, keyboard shortcuts (j/k, a, r).
   - Each inbox item shows the GST split (taxable value, CGST/SGST or IGST) and any TDS deducted, all editable before approval. The split comes from extraction and backend services; the UI doesn't compute tax.
2. Bank statement upload, using the same file-connector flow as Settings → Integrations: CSV goes straight to `importBankRows`; PDF statements are extracted by the AI into the same row shape first.
3. Show matching results: matched, needs review.

**Day 4: bills and invoices**
1. Bills: upload (Vercel Blob) → AI extraction → `createInboxItemFromExtraction` → appears in the inbox.
2. Invoice builder UI calling `createInvoice`; GST-compliant invoice PDF with @react-pdf/renderer, rendered server-side only; download button.
   - Builder fields: supply type (intra/inter-state, set automatically from place of supply, can be overridden), export / SEZ / reverse-charge flags, and a GST rate on each line. Supply type and tax amounts come from backend services, not UI maths.
   - Credit note flow: raise a credit note from an existing invoice.
3. Invoices list with receivables ageing (current, 30, 60, 90+ days).

**Day 5: reports and money screens**
1. P&L and balance sheet screens with drill-down to entries.
2. Revenue screen: by stream and customer. Cash screen: balances and reconciliation status.
3. Ledger view for the CA: journal and trial balance.

**Day 6: GST, CA review, polish**
1. GST screen: monthly summary from `getGstSummary`, download buttons, deadlines.
   - "Download GSTR-1 (draft)" button, with a note that the CA checks it in the GST offline tool before filing.
2. CA review screen: lock period, Tally export download, audit log viewer.
3. "Move from Tally or Zoho Books" import flow: upload file → preview what will be imported → run → show the trial-balance check (matches / difference).
4. Polish: empty states, skeletons, error states; check every page for client bundle size and Lighthouse performance; fix regressions.

**Day 7: onboarding and launch**
1. Consent screen, shown before any real data is connected: what we store, where it's stored (region), who can see it, and how to export or delete it. Record acceptance with a timestamp and the user who accepted.
2. Onboarding flow: business type → GST profile → consent → connect Razorpay → upload a bank statement or import from Tally → see the dashboard.
3. Admin-only check showing which AI provider is active. In production, show a warning banner if it's the free tier.
4. Re-run the bill eval; note accuracy.
5. Click through every screen with the demo org, fix bugs, deploy.

## End of every day
Print a summary for Ayush to paste to his advisor, in this format:
- Day N — done / not done (per task)
- PRs merged
- Requests for the backend (new fields, functions, signature changes)
- AI eval results (if run)
- Bugs or risks found
- What's first tomorrow
