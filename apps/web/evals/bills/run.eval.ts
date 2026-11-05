/**
 * Runs bill extraction on every synthetic bill and reports field-level
 * accuracy:
 *   npm run eval:bills
 * Writes docs/evals/bills-<date>.md (summary) and .json (every field).
 *
 * Synthetic bills only. This calls the configured fastModel (Gemini free tier
 * in dev); never point it at real customer bills.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { it } from "vitest"
import { z } from "zod"

import {
  aiBillExtractionSchema,
  type LowConfidenceField,
} from "@/server/ai/bill-extraction"
import { extractBill } from "@/server/ai/extract-bill"
import { fastModel } from "@/server/ai/models"

import type { GroundTruth, Quality } from "./fixtures"
import { type FieldScore, scoreBill, scoreFailure } from "./score"

const DATA_DIR = fileURLToPath(new URL("./data", import.meta.url))
const REPORT_DIR = fileURLToPath(
  new URL("../../../../docs/evals", import.meta.url)
)
/** Free tier allows ~15 requests/minute; stay under it. */
const MIN_GAP_MS = 4500
const ATTEMPTS = 4

const groundTruthSchema = z.object({
  id: z.string(),
  file: z.string(),
  mediaType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  layout: z.enum(["classic", "summary", "minimal", "service", "receipt"]),
  quality: z.enum(["pdf", "image-clean", "image-low"]),
  supply: z.enum(["intra", "inter"]),
  notes: z.array(z.string()),
  expected: aiBillExtractionSchema.omit({ lowConfidenceFields: true }),
})

interface BillResult {
  id: string
  layout: string
  quality: Quality
  notes: string[]
  error: string | null
  ms: number
  flags: LowConfidenceField[]
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

function report(results: BillResult[], date: string): string {
  const all = results.flatMap((r) => r.scores)
  const overall = accuracy(all)
  const fields = [...new Set(all.map((s) => s.field))]
  const wrong = all.filter((s) => !s.correct)
  const flagged = all.filter((s) => s.flagged)
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
    "## Low-confidence flags",
    "",
    `- Wrong fields that were flagged (recall): ${pct(wrong.filter((s) => s.flagged).length, wrong.length)} (${wrong.filter((s) => s.flagged).length}/${wrong.length})`,
    `- Flagged fields that were wrong (precision): ${pct(flagged.filter((s) => !s.correct).length, flagged.length)} (${flagged.filter((s) => !s.correct).length}/${flagged.length})`,
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
  const truths: GroundTruth[] = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const raw: unknown = JSON.parse(readFileSync(join(DATA_DIR, f), "utf8"))
      return groundTruthSchema.parse(raw)
    })

  const results: BillResult[] = []
  let last = 0
  for (const truth of truths) {
    const data = new Uint8Array(readFileSync(join(DATA_DIR, truth.file)))
    let error: string | null = null
    let scores: FieldScore[] = []
    let flags: LowConfidenceField[] = []
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
        flags = result.lowConfidenceFields
        scores = scoreBill(truth.expected, result.extraction, flags)
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
      flags,
      scores,
    })
    console.info(
      `${truth.id}: ${error ? `FAILED ${error.slice(0, 100)}` : accuracy(scores).text}`
    )
  }

  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date())
  mkdirSync(REPORT_DIR, { recursive: true })
  writeFileSync(join(REPORT_DIR, `bills-${date}.md`), report(results, date))
  writeFileSync(
    join(REPORT_DIR, `bills-${date}.json`),
    `${JSON.stringify({ date, model: modelName(), results }, null, 2)}\n`
  )
})
