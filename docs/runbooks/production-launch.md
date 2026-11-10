# Runbook: empty production and apply migrations

One-time launch step. It empties the production Neon branch, applies every
migration in `apps/web/drizzle`, and seeds nothing. Afterwards production holds
the schema and no rows.

## 0. The gate: don't start without this

**Run this only after Ayush has written the go-ahead in his own words**, in
the PR or chat thread for this runbook, e.g. "Go: empty production and apply
migrations." A thumbs-up, "ok" or someone relaying his go doesn't count. Paste
a link to his message here before step 1:

> Go-ahead: _link_ · _date and time (IST)_

Also check before starting:

- [ ] Every launch PR is merged to `main` and CI is green on `main`.
- [ ] The production deploy is built from that `main` commit.
- [ ] Nobody is using production: no design partner has signed up yet.
- [ ] You have the production connection string from the Neon console. It
      stays in your shell for this run only. **Never put it in
      `apps/web/.env.local`.**

## 1. Production environment variables (Vercel, Production scope)

Every one must be set before migrating, or the first request fails.

| Variable                                 | Value                                                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                           | Neon production branch, **pooled** connection string                                                                                           |
| `BETTER_AUTH_SECRET`                     | New for production: `openssl rand -base64 32`. Not the dev value.                                                                              |
| `BETTER_AUTH_URL`                        | The production URL, e.g. `https://app.median.in`                                                                                               |
| `CREDENTIALS_ENCRYPTION_KEY`             | New for production: `openssl rand -base64 32`. Store a copy in the password manager; losing it makes stored connection credentials unreadable. |
| `BLOB_READ_WRITE_TOKEN`                  | Token of the production Blob store (private, region `bom1`)                                                                                    |
| `CRON_SECRET`                            | New random value. Without it `/api/cron/sync` refuses to run.                                                                                  |
| `GOOGLE_GENERATIVE_AI_API_KEY`           | A key on a project **with billing enabled**                                                                                                    |
| `AI_PROVIDER_TIER`                       | `paid`. Anything else blocks every import, sync, upload and AI extraction in production (`PAID_AI_REQUIRED`).                                  |
| `RAZORPAY_MODE`                          | `live` only when live read-only keys are set; otherwise leave unset (test mode).                                                               |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Production Razorpay keys                                                                                                                       |

`VERCEL_ENV=production` is set by Vercel itself; don't set it by hand.

## 2. Point one shell at production

Use a fresh terminal and close it when you're done.

```sh
cd apps/web
export DATABASE_URL='<production pooled connection string>'
node -e 'console.log(new URL(process.env.DATABASE_URL).host)'
```

The host must be the production endpoint (`ep-royal-violet-…`). If it's
anything else, stop. An exported `DATABASE_URL` overrides `.env.local`
(`process.loadEnvFile` never replaces a variable that's already set), so
`npm run db:migrate` uses the export.

In the Neon console, confirm the project's region is **AWS Asia Pacific
(Singapore), `aws-ap-southeast-1`**. Vercel functions run in `sin1`
(`apps/web/vercel.json`).

## 3. Back up what's there

In the Neon console: **Branches → production → Create branch**, name it
`pre-launch-backup-YYYYMMDD`, from **Head**. This is the way back in step 8.
Keep it until a week after launch, then delete it.

Record what was in production (Neon SQL editor, on the production branch):

```sql
SELECT
  (SELECT count(*) FROM "user")             AS users,
  (SELECT count(*) FROM organization)       AS organizations,
  (SELECT count(*) FROM journal_entries)    AS journal_entries;
```

Write the numbers here: _users · organizations · journal entries_.

## 4. Empty the branch

The ledger and audit tables reject `UPDATE`, `DELETE` and `TRUNCATE` by
trigger (migration 0001). That's correct for live books, so empty the branch
by dropping the schemas instead. Run this in the Neon SQL editor **on the
production branch** (check the branch picker first):

```sql
BEGIN;
DROP SCHEMA IF EXISTS drizzle CASCADE;  -- the migrations journal
DROP SCHEMA public CASCADE;             -- every table, trigger, function, btree_gist
CREATE SCHEMA public;
COMMIT;
```

Drop `drizzle` too. If its `__drizzle_migrations` table survives, the migrator
treats every migration as already applied and creates nothing.

## 5. Apply every migration

From the shell in step 2:

```sh
npm run db:migrate
```

Expect `Migrations applied.`. If a migration fails, the script prints the
Postgres error. Stop there; don't hand-edit production.

## 6. Verify

In the Neon SQL editor, on production:

```sql
-- One row per file in apps/web/drizzle (0000 to 0017 at launch: 18).
SELECT count(*) FROM drizzle.__drizzle_migrations;

-- Append-only triggers on the ledger and the audit log: 6 rows.
SELECT tgname FROM pg_trigger
WHERE tgname LIKE '%append_only' OR tgname LIKE '%no_truncate';

-- Nothing seeded: all zero.
SELECT
  (SELECT count(*) FROM "user")          AS users,
  (SELECT count(*) FROM organization)    AS organizations,
  (SELECT count(*) FROM journal_entries) AS journal_entries,
  (SELECT count(*) FROM audit_log)       AS audit_rows;
```

## 7. Seed nothing

Don't run any of these against production:

- `npm run test:dev-db` or any devcheck. They create organisations and post
  entries.
- `npm run db:import-hsn`. HSN/SAC master rates are reference data, but they
  aren't part of this run. Ayush decides separately whether production gets
  them. Without them, bill lines that don't print a rate are flagged for
  review instead of defaulted.
- Any demo organisation.

Then close the shell from step 2.

## 8. Smoke test, or roll back

Smoke test on the production URL:

1. Sign up with a team email. An organisation is created and every list is
   empty.
2. **Settings → AI** shows tier `paid`, and the free-tier banner doesn't
   appear.
3. `curl -i https://<prod>/api/cron/sync` with no header returns `401`.

If anything fails and can't be fixed forward: in the Neon console, restore
production from `pre-launch-backup-YYYYMMDD`, or point `DATABASE_URL` at that
branch and redeploy. Then post what happened in the thread.

## Done

Post in the thread: the time it finished, the migration count from step 6, and
that the backup branch exists.
