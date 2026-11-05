# Bill extraction eval

30 synthetic GST invoices with ground truth, plus a runner that extracts each
one with `extractBill` (`src/server/ai/extract-bill.ts`) and reports
field-level accuracy.

**Synthetic data only.** Every vendor, GSTIN and amount here is invented. The
eval calls the configured `fastModel` (Gemini free tier in dev). Never add real
or anonymised customer bills.

## Run

From `apps/web`, with `GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local`:

```sh
npm run eval:bills            # ~3–5 min, rate-limited for the free tier
npm run eval:bills:generate   # only if you change the fixtures
```

Results go to `docs/evals/bills-<date>.md` (summary) and `.json` (every field).
Neither command runs as part of `npm test`.

## The bills (`data/`)

`bill-NN.{pdf,png,jpg}` is the document and `bill-NN.json` is its ground truth
(`expected` has the same shape as the AI output, minus `lowConfidenceFields`).
They're generated from a seed in `fixtures.ts`, so the ground truth is
reproducible.

| Bills | Layout | Format |
| --- | --- | --- |
| 01–06 | classic: per-line CGST/SGST or IGST columns | PDF |
| 07–12 | summary: tax summary by rate, no per-line tax | PDF |
| 13–18 | minimal: modern layout, "Tax" column | PDF |
| 19–24 | service: SAC only, no quantity or rate | PDF |
| 25–27 | classic scan: 25 clean PNG, 26–27 low-quality JPEG | image |
| 28–30 | thermal receipt: 28 clean PNG, 29–30 low-quality JPEG | image |

The mix includes intra-state (CGST + SGST) and inter-state (IGST) bills, 1–6
lines, 5% and 18% slabs, four date formats, three place-of-supply formats,
round-off lines, bills with and without due dates, and bills with missing HSN
codes (04, 10, 16, 27).

## Scoring

Each field is right or wrong. Text is compared ignoring case and punctuation,
codes ignore spaces and hyphens, amounts are parsed to integer paise, and
quantities and rates are compared as numbers. Dates must be exact
`YYYY-MM-DD`. A field that isn't printed must come back null. A value there is
counted as **invented** (computed or guessed), which the AI must never do. The
report also shows how well `lowConfidenceFields` catches the wrong fields.
