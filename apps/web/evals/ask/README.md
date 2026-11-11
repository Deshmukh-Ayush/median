# Ask Median eval

30 questions about a synthetic company, answered by the real `ask()`
(`src/server/ai/ask/ask.ts`: `smartModel`, the same read-only tools and
prompt as `POST /api/ask`), scored in code. No model grades another.

**Synthetic data only.** The runner seeds a fresh org ("Lakshmi Analytics",
invented names, GSTINs and amounts) in the **dev-app** database and refuses
any other host. It sends that org's books to the configured model (Gemini
free tier in dev). Never point it at real customer data.

## Run

From `apps/web`, with `DATABASE_URL` (dev-app) and
`GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local`:

```sh
npm run eval:ask                          # ~10–15 min, paced for the free tier
ASK_EVAL_TRUTH_ONLY=1 npm run eval:ask    # check the seed against the services, no model calls
```

Results go to `docs/evals/ask-<date>.md` (summary) and `.json` (every
answer and the tools it called). Not part of `npm test`.

## The data (`seed.ts`)

One month, October 2026, through the real services (`postManualEntry`,
`createParty`, `createInvoice`, `updateGstProfile`): capital, rent, software,
salaries, three unpaid 18% invoices (intra-state, inter-state, unregistered)
and a vendor. The expected figures are worked out by hand in the file's
header. Before any question is asked, the runner checks every expected value
against the services' own output ("ground truth matched").

## The questions (`cases.ts`)

| Topic                              | Cases |
| ---------------------------------- | ----- |
| Profit and loss                    | 6     |
| Balance sheet and trial balance    | 5     |
| GST                                | 4     |
| Revenue by customer                | 3     |
| Invoices                           | 4     |
| Receivables (as of today)          | 3     |
| Customers and vendors              | 2     |
| Cash                               | 1     |
| Can't answer ("I don't know")      | 1     |
| Read-only (asked to post an entry) | 1     |

## Scoring (`score.ts`)

A figure case passes when the answer:

1. quotes every expected value **exactly** (`₹1,20,000.00`, not `₹1.2 lakh`
   or `₹1,20,000`; "near" in the report means the digits matched but not the
   quote),
2. links at least one expected source page,
3. quotes **no ₹ amount that no tool returned** (the model computed or made
   it up), and
4. links no page that wasn't in a tool's `sources`.

"Can't answer" passes on an "I don't know"-style reply with no figure. The
read-only case passes when the model declines and the journal has the same
entries before and after.
