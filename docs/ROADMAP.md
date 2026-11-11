# Roadmap: onboarding → CA P0 → earned autonomy → India agents

The shared tracker for Vedant and Ayush. Claim an item by putting your name
and branch on it in the PR that starts it, and add the PR link when it opens.
Tracking issue: [#94](https://github.com/Deshmukh-Ayush/median/issues/94).

Status: `todo` · `in progress` · `in review` · `done` · `blocked`

## The rule every PR is reviewed against

Median's AI keeps the books. It posts entries only when (a) a person approves
an entry or (b) the entry matches a rule a person has approved. Posted entries
are never updated or deleted, only reversed, and each records who or what
posted it (user, rule ID and version, or import) and links to its source.
GST, TDS and totals are calculated in code; matching is deterministic code;
LLMs read, classify, explain and propose rules, and do no arithmetic.

## Phase 0: direction and tracking

| #   | Item                                                                 | Owner  | Branch                          | PR                                                      | Status    |
| --- | -------------------------------------------------------------------- | ------ | ------------------------------- | ------------------------------------------------------- | --------- |
| 0   | Direction change in CLAUDE.md, this tracker, ledger invariant checks | Vedant | `chore/roadmap-earned-autonomy` | [#95](https://github.com/Deshmukh-Ayush/median/pull/95) | in review |

## Phase 1: unblock onboarding

| #   | Item                                                                                                                                                                      | Owner | Branch | PR  | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | --- | ------ |
| 1.1 | Customer and vendor screens (list, create, edit, archive; GSTIN checksum, PAN, registration type, TDS/MSME fields, opening balance); "new customer" from the invoice form |       |        |     | todo   |
| 1.2 | Due date follows invoice date and payment terms                                                                                                                           |       |        |     | todo   |
| 1.3 | Credit note PDF with Rule 53 particulars                                                                                                                                  |       |        |     | todo   |
| 1.4 | Database resilience: retries, readable errors, real error logging, batched settlement import                                                                              |       |        |     | todo   |
| 1.5 | Readable audit-log labels                                                                                                                                                 |       |        |     | todo   |

## Phase 2: CA P0

| #    | Item                                                                                                                  | Owner | Branch | PR  | Status |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ----- | ------ | --- | ------ |
| 2.1a | Bills: schema (bills, lines, payments, advances, allocations)                                                         |       |        |     | todo   |
| 2.1b | Bills: entry (manual and from the AI bill reader) and posting                                                         |       |        |     | todo   |
| 2.1c | Bills: payments matched to bank lines; vendor advances                                                                |       |        |     | todo   |
| 2.1d | Bills: payables ageing, vendor statement, duplicate-bill warning, bills page                                          |       |        |     | todo   |
| 2.2a | TDS: dated section master (194C/J/I/H/Q, 192), 206AA, lower-deduction certificates                                    |       |        |     | todo   |
| 2.2b | TDS: posting on bills, challan tracker                                                                                |       |        |     | todo   |
| 2.2c | TDS: 26Q quarterly export                                                                                             |       |        |     | todo   |
| 2.3  | Manual journal screen (multi-line, attachments, period locks, auto-reversal date)                                     |       |        |     | todo   |
| 2.3b | Recurring journal templates                                                                                           |       |        |     | todo   |
| 2.4  | Reports: day book, general ledger, party ledger, trial balance and Schedule III with prior-year columns, .xlsx export |       |        |     | todo   |
| 2.5  | GSTR-2B import and matching; 17(5) blocked credit; Rule 37 reversal; 3B Table 4                                       |       |        |     | todo   |

## Phase 3: earned autonomy

| #   | Item                                                                                     | Owner | Branch | PR  | Status |
| --- | ---------------------------------------------------------------------------------------- | ----- | ------ | --- | ------ |
| 3.1 | Rules model: scope, action, approval, status, confidence, counts; versioned              |       |        |     | todo   |
| 3.2 | Flow: approve entry → AI proposes rule → approve rule → engine posts as `rule:<id>@v<n>` |       |        |     | todo   |
| 3.3 | Trust decay: reversals lower confidence; pause past threshold                            |       |        |     | todo   |
| 3.4 | Guardrails: locked period, amount cap, unverified vendor bank, uncertain GST/TDS         |       |        |     | todo   |
| 3.5 | UI: rules page, "approve + create rule", posted-by on every entry                        |       |        |     | todo   |
| 3.6 | Audit rows for every auto-posting (rule version, source row, lines)                      |       |        |     | todo   |

## Phase 4: India agents

| #   | Item                                                                         | Owner | Branch | PR  | Status |
| --- | ---------------------------------------------------------------------------- | ----- | ------ | --- | ------ |
| 4.1 | GSTR-2B agent: follow-up drafts, proposed ITC reversals                      |       |        |     | todo   |
| 4.2 | TDS agent: section proposals, thresholds, challan summary, 26AS/AIS matching |       |        |     | todo   |

## Housekeeping and test data

| #   | Item                                                                         | Owner  | Branch     | PR  | Status                               |
| --- | ---------------------------------------------------------------------------- | ------ | ---------- | --- | ------------------------------------ |
| H.1 | Delete the CA-review test org from the dev database; remove local test files | Vedant | local only | –   | todo                                 |
| H.2 | Valid GSTINs in `test-kit/expected.md` (local: `test-kit/` is gitignored)    | Vedant | local only | –   | todo                                 |
| T.1 | Acme Labs Oct 2026 dataset and end-to-end exception test                     |        |            |     | blocked: waiting for the dataset zip |
