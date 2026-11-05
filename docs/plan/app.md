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
- Never edit the backend's folders (`packages/ledger`, `apps/web/src/server/db`, `src/server/integrations`, `src/server/services`, `src/server/reports`) and never generate migrations. Pages get data only by calling functions in `src/server/services`. If you need a new field or function, stop and write the request in your end-of-day summary.
- If you need a new dependency, add it in its own small PR.
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
4. App shell: sidebar with Home, AI inbox, Revenue, Cash, Invoices, Bills, GST, Reports, Ledger, Settings; Ctrl+K command bar.
5. After the contract merges: Home screen wired to `getDashboardSummary` (stub data is fine).

**Day 2: AI extraction and connections**
1. In `src/server/ai`: Zod schemas for bill extraction (vendor, GSTIN, invoice number, date, line items, HSN/SAC, taxable value, tax rates as printed) using `generateObject` with `fastModel`. The AI extracts; it never computes totals.
2. An eval script: run 30 sample bills (fake or anonymised) and report field-level accuracy. Save results to `docs/evals/`.
3. Settings → Connections: Razorpay key form calling `connectRazorpay`, sync button calling `syncRazorpay`, last synced time.

**Day 3: AI inbox and bank upload**
1. AI inbox: cursor-paginated list, detail panel with the source document, confidence and reason, approve / edit / reject, bulk approve, keyboard shortcuts (j/k, a, r).
2. Bank statement upload: CSV goes straight to `importBankRows`; PDF statements are extracted by the AI into the same row shape first.
3. Show matching results: matched, needs review.

**Day 4: bills and invoices**
1. Bills: upload (Vercel Blob) → AI extraction → `createInboxItemFromExtraction` → appears in the inbox.
2. Invoice builder UI calling `createInvoice`; GST-compliant invoice PDF with @react-pdf/renderer, rendered server-side only; download button.
3. Invoices list with receivables ageing (current, 30, 60, 90+ days).

**Day 5: reports and money screens**
1. P&L and balance sheet screens with drill-down to entries.
2. Revenue screen: by stream and customer. Cash screen: balances and reconciliation status.
3. Ledger view for the CA: journal and trial balance.

**Day 6: GST, CA review, polish**
1. GST screen: monthly summary from `getGstSummary`, download buttons, deadlines.
2. CA review screen: lock period, Tally export download, audit log viewer.
3. Polish: empty states, skeletons, error states; check every page for client bundle size and Lighthouse performance; fix regressions.

**Day 7: onboarding and launch**
1. Onboarding flow: business type → connect Razorpay → upload a bank statement → see the dashboard.
2. Re-run the bill eval; note accuracy.
3. Click through every screen with the demo org, fix bugs, deploy.

## End of every day
Print a summary for Ayush to paste to his advisor, in this format:
- Day N — done / not done (per task)
- PRs merged
- Requests for the backend (new fields, functions, signature changes)
- AI eval results (if run)
- Bugs or risks found
- What's first tomorrow
