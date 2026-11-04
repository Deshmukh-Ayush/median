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

- The AI never does maths. Tax, totals and amount matching are deterministic
  code. AI only extracts and suggests, and its output goes to an approval
  queue, never straight into the ledger.
- All AI calls go through `apps/web/src/server/ai/models.ts` (enforced by
  ESLint). Gemini free tier is for test data only; never send real customer
  data to it.
- Agents (added later with eve) live in `apps/web/agent/` and only call ledger
  functions that propose entries.

## Multi-tenancy

- Every business table has `organization_id`, and every query is scoped by it.

## Workflow

- Build in thin vertical slices.
- Run `npm run typecheck && npm test` before every commit.

## Formatting for India

- Indian number format: ₹1,23,45,678, with lakh/crore grouping.

@AGENTS.md
