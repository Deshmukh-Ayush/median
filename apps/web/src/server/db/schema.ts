// Drizzle schema. Empty for now.
//
// Rules (see CLAUDE.md):
// - every business table has `organization_id`, and every index on a query
//   path starts with it;
// - money columns are `bigint` paise (`bigint("amount", { mode: "bigint" })`);
// - posted ledger rows are append-only.
//
// Better Auth tables are generated into this folder with the Better Auth CLI.

export {}
