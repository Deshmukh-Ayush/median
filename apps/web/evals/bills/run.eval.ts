/**
 * Runs bill extraction on every synthetic bill and reports field-level
 * accuracy:
 *   npm run eval:bills
 * Writes docs/evals/bills-<date>.md (summary) and .json (every field).
 *
 * Synthetic bills only. This calls the configured fastModel (Gemini free tier
 * in dev); never point it at real customer bills.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { it } from "vitest"

import { todayIso } from "@/lib/format-date"
import type { ReviewFlag } from "@/server/ai/bill-review"
import { extractBill } from "@/server/ai/extract-bill"
import { fastModel } from "@/server/ai/models"

import { loadGroundTruth, type Quality } from "./fixtures"
import { type MisreadStats, simulateMisreads } from "./misreads"
import { type FieldScore, scoreBill, scoreFailure } from "./score"

const DATA_DIR = fileURLToPath(new URL("./data", import.meta.url))
const REPORT_DIR = fileURLToPath(
  new URL("../../../../docs/evals", import.meta.url)
)
/** Free tier allows ~15 requests/minute; stay under it. */
const MIN_GAP_MS = 4500
const ATTEMPTS = 4

interface BillResult {
  id: string
  layout: string
  quality: Quality
  notes: string[]
  error: string | null
  ms: number
  needsReview: ReviewFlag[]
  notPrinted: ReviewFlag[]
  scores: FieldScore[]
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /503|429|high demand|overloaded|quota|rate limit|unavailable|timeout/i.test(
    message
  )
}

const pct = (n: number, d: number) =>
  d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`

function accuracy(scores: FieldScore[]) {
  const correct = scores.filter((s) => s.correct).length
  return { correct, total: scores.length, text: pct(correct, scores.length) }
}

function modelName(): string {
  return typeof fastModel === "string"
    ? fastModel
    : `${fastModel.provider}:${fastModel.modelId}`
}

const sum = (stats: MisreadStats[], key: "total" | "caught" | "pinpointed") =>
  stats.reduce((n, m) => n + m[key], 0)

function report(
  results: BillResult[],
  misreads: MisreadStats[],
  date: string
): string {
  const all = results.flatMap((r) => r.scores)
  const overall = accuracy(all)
  const fields = [...new Set(all.map((s) => s.field))]
  const wrong = all.filter((s) => !s.correct)
  const flagged = all.filter((s) => s.flagged)
  const needsReview = results.flatMap((r) => r.needsReview)
  const billOf = (s: FieldScore) =>
    results.find((r) => r.scores.includes(s))?.id ?? "?"
  const invented = all.filter((s) => s.invented)
  const failed = results.filter((r) => r.error)

  const lines: string[] = [
    `# Bill extraction eval: ${date}`,
    "",
    `- Model: \`${modelName()}\` (fastModel), temperature 0`,
    `- Bills: ${results.length} synthetic GST invoices (${results.filter((r) => r.quality === "pdf").length} PDF, ${results.filter((r) => r.quality === "image-clean").length} clean images, ${results.filter((r) => r.quality === "image-low").length} low-quality scans). No real data.`,
    `- Extraction failures: ${failed.length}${failed.length ? ` (${failed.map((r) => r.id).join(", ")})` : ""}`,
    "",
    `**Field-level accuracy: ${overall.text}** (${overall.correct}/${overall.total} fields)`,
    "",
    "## By document type",
    "",
    "| Type | Bills | Accuracy |",
    "| --- | ---: | ---: |",
    ...(["pdf", "image-clean", "image-low"] as const).map((q) => {
      const rs = results.filter((r) => r.quality === q)
      return `| ${q} | ${rs.length} | ${accuracy(rs.flatMap((r) => r.scores)).text} |`
    }),
    "",
    "## By field",
    "",
    "| Field | Accuracy | Wrong | Invented (not printed) | Wrong but flagged |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...fields.map((f) => {
      const s = all.filter((x) => x.field === f)
      const w = s.filter((x) => !x.correct)
      return `| \`${f}\` | ${accuracy(s).text} | ${w.length} | ${s.filter((x) => x.invented).length} | ${w.filter((x) => x.flagged).length} |`
    }),
    "",
    "## Review flags",
    "",
    "Deterministic checks in `bill-review.ts`: GSTIN checksum, state vs tax type, HSN/SAC length, dates, and lines and taxes adding up to the printed totals. Only **needs review** reaches the inbox; **not printed** is informational.",
    "",
    `- Needs review: **${needsReview.length}** flags on ${results.filter((r) => r.needsReview.length > 0).length}/${results.length} bills (${needsReview.filter((f) => f.source === "check").length} from checks, ${needsReview.filter((f) => f.source === "model").length} from the model's own flags)`,
    `- Not printed (informational): ${results.reduce((n, r) => n + r.notPrinted.length, 0)}`,
    `- Real misreads flagged needs review: **${wrong.filter((s) => s.flagged).length} of ${wrong.length}**`,
    ...wrong.map(
      (s) =>
        `  - ${billOf(s)} \`${s.path}\`: ${s.flagged ? "caught" : "missed"}`
    ),
    `- Needs-review flags on fields that were read correctly: ${flagged.filter((s) => s.correct).length}`,
    "",
    ...results
      .filter((r) => r.needsReview.length > 0)
      .map(
        (r) =>
          `- ${r.id}: ${r.needsReview.map((f) => `\`${f.field}\` (${f.source}: ${f.reason})`).join("; ")}`
      ),
    "",
    "## Simulated misreads (offline)",
    "",
    "One digit changed in one printed field of each correct bill, then reviewed. *Caught*: the bill gets a needs-review flag. *Pinpointed*: the changed field itself is flagged.",
    "",
    "| Field | Misreads | Caught | Pinpointed |",
    "| --- | ---: | ---: | ---: |",
    ...misreads.map(
      (m) =>
        `| \`${m.field}\` | ${m.total} | ${pct(m.caught, m.total)} | ${pct(m.pinpointed, m.total)} |`
    ),
    `| **All** | ${sum(misreads, "total")} | ${pct(sum(misreads, "caught"), sum(misreads, "total"))} | ${pct(sum(misreads, "pinpointed"), sum(misreads, "total"))} |`,
    "",
    "## No-maths check",
    "",
    `Fields not printed on the bill where the model returned a value anyway: **${invented.length}**. These are likely computed or guessed values, which the AI must never produce.`,
    ...invented
      .slice(0, 20)
      .map(
        (s) =>
          `- ${results.find((r) => r.scores.includes(s))?.id ?? "?"} \`${s.path}\`: got "${s.actual ?? ""}"`
      ),
    "",
    "## Per bill",
    "",
    "| Bill | Layout | Type | Notes | Accuracy | Errors |",
    "| --- | --- | --- | --- | ---: | --- |",
    ...results.map((r) => {
      const errors = r.error
        ? `extraction failed: ${r.error.slice(0, 80)}`
        : r.scores
            .filter((s) => !s.correct)
            .map(
              (s) =>
                `\`${s.path}\` exp "${s.expected ?? "null"}" got "${s.actual ?? "null"}"${s.flagged ? " (flagged)" : ""}`
            )
            .join("<br>")
      return `| ${r.id} | ${r.layout} | ${r.quality} | ${r.notes.join(", ")} | ${accuracy(r.scores).text} | ${errors.replace(/\|/g, "\\|")} |`
    }),
    "",
    "Scoring: text is compared case- and punctuation-insensitively; codes ignore spaces and hyphens; amounts are parsed to integer paise; quantities and rates compare as numbers; dates must be exact YYYY-MM-DD. Fields not printed must come back null. Lines are compared in printed order.",
    "",
  ]
  return lines.join("\n")
}

it("extracts all synthetic bills and reports field-level accuracy", async () => {
  process.loadEnvFile(".env.local")
  const truths = loadGroundTruth(DATA_DIR)

  const results: BillResult[] = []
  let last = 0
  for (const truth of truths) {
    const data = new Uint8Array(readFileSync(join(DATA_DIR, truth.file)))
    let error: string | null = null
    let scores: FieldScore[] = []
    let needsReview: ReviewFlag[] = []
    let notPrinted: ReviewFlag[] = []
    const started = Date.now()
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      await wait(Math.max(0, last + MIN_GAP_MS - Date.now()))
      last = Date.now()
      try {
        const result = await extractBill({
          data,
          mediaType: truth.mediaType,
          filename: truth.file,
        })
        needsReview = result.needsReview
        notPrinted = result.notPrinted
        scores = scoreBill(truth.expected, result.extraction, needsReview)
        error = null
        break
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
        if (!isTransient(e) || attempt === ATTEMPTS) break
        await wait(15_000 * attempt)
      }
    }
    if (error) scores = scoreFailure(truth.expected)
    results.push({
      id: truth.id,
      layout: truth.layout,
      quality: truth.quality,
      notes: truth.notes,
      error,
      ms: Date.now() - started,
      needsReview,
      notPrinted,
      scores,
    })
    console.info(
      `${truth.id}: ${error ? `FAILED ${error.slice(0, 100)}` : accuracy(scores).text}`
    )
  }

  const date = todayIso()
  const misreads = simulateMisreads(truths, date)
  mkdirSync(REPORT_DIR, { recursive: true })
  writeFileSync(
    join(REPORT_DIR, `bills-${date}.md`),
    report(results, misreads, date)
  )
  writeFileSync(
    join(REPORT_DIR, `bills-${date}.json`),
    `${JSON.stringify({ date, model: modelName(), results }, null, 2)}\n`
  )
})
