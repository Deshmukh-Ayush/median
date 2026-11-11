# Median: rules for working in this repo

These rules are not optional. Tooling enforces some of them; the rest are on
you.

## Types

- Never use `any`: explicit, implicit, or `as any`. ESLint and `tsc` will fail.
- External data (API responses, CSV rows, AI output, request bodies) is typed
  `unknown` and parsed with Zod before use.
- `@ts-ignore` is banned. `@ts-expect-error` is allowed only with a reason.

## Performance

Performance is a priority.

- Server Components by default. `"use client"` only for components that need
  interaction, kept small and at the leaves.
- Minimal client JS. Heavy libraries (`@react-pdf/renderer`, `papaparse`) are
  imported only on the server or with dynamic `import()`.
- Stream slow parts with `<Suspense>`.
- Paginate every list, cursor-based.
- No N+1 queries.
- Index every query path, with `organization_id` first.
- Measure before adding any dependency (`npm run analyze` in `apps/web`).

## Money and the ledger

- Money is always integer paise: `bigint` in Postgres, `Money` from
  `@workspace/ledger` in TypeScript. Never floats.
- The ledger is append-only. Corrections are reversal entries; never UPDATE or
  DELETE posted entries.
- Every entry must balance and is rejected in a locked period.
- Every change to the books writes an audit log row (who, what, when, source).
  The audit trail can't be disabled.
- `packages/ledger` never imports Next.js, the database or AI code (enforced by
  ESLint).

## AI

- Median's AI keeps the books, but an entry posts only in one of two ways:
  (a) a person approves it, or (b) it matches a rule a person has approved.
  Rules are versioned; the deterministic rule engine applies them, and the AI
  isn't in that loop. Every entry records who or what posted it (user, rule
  ID and version, or import) and links to its source file and row.
- The AI never does maths. GST, TDS and totals are calculated in code, never
  taken from model output, and matching is deterministic code. LLMs read
  documents, classify, explain and propose rules.
- All AI calls go through `apps/web/src/server/ai/models.ts` (enforced by
  ESLint). Gemini free tier is for test data only; never send real customer
  data to it.
- Agents (added later with eve) live in `apps/web/agent/`. They propose
  entries and rules; they never call `postEntry` directly.

## Multi-tenancy

- Every business table has `organization_id`, and every query is scoped by it.

## Workflow

- Build in thin vertical slices.
- Run `npm run typecheck && npm test` before every commit.
- Track work in `docs/ROADMAP.md`: claim an item (owner, branch) in the PR
  that starts it, and add the PR link when it opens.
- Ledger invariants (`apps/web/devchecks/ledger-invariants.check.ts`) run
  against the dev database before every PR that touches posting:
  `npm run test:dev-db -- ledger-invariants` in `apps/web`.

## Formatting for India

- Indian number format: ₹1,23,45,678, with lakh/crore grouping.

@AGENTS.md
