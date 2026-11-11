# Median

Median is an AI-native revenue and ledger platform for Indian businesses. It
keeps a double-entry, append-only ledger in integer paise, issues GST-ready
invoices and reconciles payments. AI reads documents and suggests entries and
rules. An entry posts only when a person approves it or it matches a rule a
person has approved; see [docs/ROADMAP.md](./docs/ROADMAP.md).

## Structure

```
apps/web/                 Next.js app (App Router, src/ dir)
  src/app/                pages + API routes (/api/health, /api/auth/[...all])
  src/server/db/          Drizzle schema + Neon client
  src/server/auth/        Better Auth config (organizations: owner, finance, ca, investor)
  src/server/ai/models.ts the single AI model module (fastModel, smartModel)
  drizzle.config.ts       drizzle-kit config
  vercel.json             functions pinned to sin1 (Singapore)
packages/ui/              shadcn/ui components (Base UI, Tailwind v4)
packages/ledger/          pure TypeScript ledger rules (Money, validateEntry)
packages/eslint-config/   shared ESLint config (type-aware, no `any`)
packages/typescript-config/ shared strict tsconfig
```

## Running locally

Requires Node 22 (`nvm use`) and npm.

```bash
npm install
cp .env.example apps/web/.env.local   # then fill in the values
npm run dev                           # http://localhost:3000
```

Other scripts (run from the repo root):

| Script              | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run build`     | production build                    |
| `npm run lint`      | ESLint, zero warnings allowed       |
| `npm run typecheck` | `tsc --noEmit` in every package     |
| `npm test`          | Vitest                              |
| `npm run format`    | Prettier (with the Tailwind plugin) |

Database and bundle tools (run inside `apps/web`): `npm run db:generate`,
`npm run db:migrate`, `npm run db:studio`, and `npm run analyze` for the
bundle analyzer.

Read [CLAUDE.md](./CLAUDE.md) before contributing.
