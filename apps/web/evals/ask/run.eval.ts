/**
 * Ask Median eval: 30 questions about a synthetic company, answered by the
 * real ask() (smartModel, the same tools and prompt as /api/ask), scored in
 * code:
 *   npm run eval:ask
 * Writes docs/evals/ask-<date>.md (summary) and .json (every answer).
 *
 * SYNTHETIC DATA ONLY. It seeds a fresh org in the dev-app database
 * (refuses any other host) and sends that org's books to the configured
 * model (Gemini free tier in dev). Never point it at real customer data.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { it } from "vitest"
import { z } from "zod"

import { todayIso } from "@/lib/format-date"
import { toModelJson } from "@/server/ai/ask/to-model-json"

import { CASES } from "./cases"
import type { AskCase, TruthCall } from "./cases"
import {
  amountsIn,
  declines,
  saysDontKnow,
  scoreFigure,
  unsupportedAmounts,
} from "./score"
import type { EvalOrg } from "./seed"

const REPORT_DIR = fileURLToPath(
  new URL("../../../../docs/evals", import.meta.url)
)
/**
 * About 3 s between model requests (OpenRouter free: 20 a minute): between
 * questions here, and between a question's steps via AI_MIN_REQUEST_GAP_MS.
 */
const GAP_MS = 3_000
const ATTEMPTS = 2
const RETRY_MS = 10_000

/** OpenRouter reports each request's cost (USD) in provider metadata. */
const costSchema = z.object({
  openrouter: z.object({ usage: z.object({ cost: z.number() }) }),
})

const sourcesSchema = z.object({
  sources: z.array(z.object({ href: z.string() })),
})

/** Read without process.env.X, which turbo wants declared per task. */
const env = (name: string): string | undefined => process.env[name]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface CaseResult {
  readonly id: string
  readonly topic: string
  readonly kind: AskCase["kind"]
  readonly question: string
  readonly answer: string
  readonly tools: readonly string[]
  readonly pass: boolean
  readonly correct: boolean
  readonly nearMiss: boolean
  readonly cited: boolean
  readonly unsupported: readonly string[]
  readonly inventedLinks: readonly string[]
  readonly expected: readonly (readonly string[])[]
  readonly truthOk: boolean
  readonly error: string | null
  readonly ms: number
  /** Model requests (steps) the answer took. */
  readonly requests: number
  /** USD, from usage.cost; null when the provider doesn't report it. */
  readonly cost: number | null
  readonly servedBy: readonly string[]
}

function guardDatabase(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set (apps/web/.env.local).")
  const host = new URL(url).host
  if (host.includes("royal-violet") || !host.includes("lucky-leaf")) {
    throw new Error(
      `Refusing to seed ${host}: the Ask eval only runs on the dev-app branch (ep-lucky-leaf).`
    )
  }
  if (env("VERCEL_ENV") === "production") {
    throw new Error("Refusing to run the Ask eval in production.")
  }
  return host
}

async function truthText(org: EvalOrg, call: TruthCall): Promise<string> {
  const s = await import("@/server/services")
  const { ctx } = org
  const result = await (async () => {
    switch (call.service) {
      case "getProfitAndLoss":
        return s.getProfitAndLoss(ctx, call.from, call.to)
      case "getBalanceSheet":
        return s.getBalanceSheet(ctx, call.asOf)
      case "getTrialBalance":
        return s.getTrialBalance(ctx, call.asOf)
      case "getGstSummary":
        return s.getGstSummary(ctx, call.period)
      case "getRevenueBreakdown":
        return s.getRevenueBreakdown(ctx, call.from, call.to)
      case "getCashPosition":
        return s.getCashPosition(ctx, call.asOf)
      case "getReceivablesAgeing":
        return s.getReceivablesAgeing(ctx, null)
      case "getInvoice":
        return s.getInvoice(ctx, org.invoices[call.invoice].id)
      case "listParties":
        return s.listParties(ctx, null, { includeArchived: true })
    }
  })()
  return JSON.stringify(toModelJson(result))
}

async function journalCount(org: EvalOrg): Promise<number> {
  const { listEntries } = await import("@/server/services")
  const page = await listEntries(org.ctx, {}, null, { limit: 200 })
  return page.items.length
}

async function askOnce(org: EvalOrg, question: string) {
  const { ask } = await import("@/server/ai/ask/ask")
  const result = await ask(org.ctx, {
    messages: [
      { id: "q", role: "user", parts: [{ type: "text", text: question }] },
    ],
    today: todayIso(),
  })
  const answer = (await result.text).trim()
  const steps = await result.steps
  const tools: string[] = []
  const outputs: unknown[] = []
  let cost: number | null = null
  const servedBy = new Set<string>()
  for (const step of steps) {
    for (const call of step.toolCalls) tools.push(call.toolName)
    for (const r of step.toolResults) outputs.push(r.output)
    servedBy.add(step.response.modelId)
    const c = costSchema.safeParse(step.providerMetadata)
    if (c.success) cost = (cost ?? 0) + c.data.openrouter.usage.cost
  }
  const sourceHrefs = new Set<string>()
  for (const out of outputs) {
    const parsed = sourcesSchema.safeParse(out)
    if (!parsed.success) continue
    for (const src of parsed.data.sources) sourceHrefs.add(src.href)
  }
  return {
    answer,
    tools,
    toolText: JSON.stringify(outputs),
    sourceHrefs,
    requests: steps.length,
    cost,
    servedBy: [...servedBy],
  }
}

async function runCase(
  org: EvalOrg,
  c: AskCase,
  truth: Map<string, string>
): Promise<CaseResult> {
  const started = Date.now()
  const expected = c.kind === "figure" ? c.expect(org).map((g) => [...g]) : []
  const truthOk =
    c.kind !== "figure" ||
    expected.every((group) =>
      group.some((s) =>
        c.truth.some((t) => truth.get(JSON.stringify(t))?.includes(s))
      )
    )
  const before = c.kind === "readonly" ? await journalCount(org) : 0

  let lastError: string | null = null
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const r = await askOnce(org, c.question)
      const base = {
        id: c.id,
        topic: c.topic,
        kind: c.kind,
        question: c.question,
        answer: r.answer,
        tools: r.tools,
        expected,
        truthOk,
        error: null,
        ms: Date.now() - started,
        requests: r.requests,
        cost: r.cost,
        servedBy: r.servedBy,
      }
      if (c.kind === "figure") {
        const s = scoreFigure({
          answer: r.answer,
          expect: expected,
          cite: c.cite(org),
          toolText: r.toolText,
          sourceHrefs: r.sourceHrefs,
        })
        return {
          ...base,
          ...s,
          pass:
            truthOk &&
            s.correct &&
            s.cited &&
            s.unsupported.length === 0 &&
            s.inventedLinks.length === 0,
        }
      }
      if (c.kind === "idk") {
        const quoted = amountsIn(r.answer)
        const ok = saysDontKnow(r.answer) && quoted.length === 0
        return {
          ...base,
          correct: ok,
          nearMiss: false,
          cited: true,
          unsupported: unsupportedAmounts(r.answer, r.toolText),
          inventedLinks: [],
          pass: ok,
        }
      }
      const after = await journalCount(org)
      const ok = declines(r.answer) && after === before
      return {
        ...base,
        correct: ok,
        nearMiss: false,
        cited: true,
        unsupported: [],
        inventedLinks: [],
        pass: ok,
      }
    } catch (error) {
      lastError = describeError(error)
      // A spent quota won't come back within a retry; stop at once.
      if (QUOTA.test(lastError)) break
      if (attempt < ATTEMPTS) await sleep(RETRY_MS)
    }
  }
  return {
    id: c.id,
    topic: c.topic,
    kind: c.kind,
    question: c.question,
    answer: "",
    tools: [],
    pass: false,
    correct: false,
    nearMiss: false,
    cited: false,
    unsupported: [],
    inventedLinks: [],
    expected,
    truthOk,
    error: lastError,
    ms: Date.now() - started,
    requests: 0,
    cost: null,
    servedBy: [],
  }
}

const QUOTA = /quota|RESOURCE_EXHAUSTED|\b429\b|rate.?limit|too many requests/i
/** Stop the run after this many cases in a row fail on the provider. */
const MAX_PROVIDER_FAILURES_IN_A_ROW = 3

/**
 * The provider's real message: stream errors surface as "No output
 * generated" with the API error (quota, 503) further down the cause chain.
 */
function describeError(error: unknown): string {
  const messages: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    messages.push(current.message)
    current = current.cause
  }
  if (messages.length === 0) messages.push(String(error))
  return messages.join(" ← ")
}

const pct = (n: number, d: number) =>
  d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ")

const usd = (n: number | null) => (n === null ? "n/a" : `$${n.toFixed(6)}`)

function totalCost(results: readonly CaseResult[]): number | null {
  const known = results.flatMap((r) => (r.cost === null ? [] : [r.cost]))
  return known.length === 0 ? null : known.reduce((x, y) => x + y, 0)
}

function expectedText(r: CaseResult): string {
  if (r.kind === "figure")
    return r.expected.map((g) => g.join(" or ")).join("; ")
  if (r.kind === "idk") return '"I don\'t know", no figure'
  return "declines; journal unchanged"
}

function whyFailed(r: CaseResult): string {
  const reasons = [
    r.error ? `provider error: ${r.error}` : null,
    r.kind === "figure" && !r.error && !r.correct
      ? r.nearMiss
        ? "right figure, not quoted exactly"
        : "expected value missing"
      : null,
    r.kind === "figure" && !r.error && !r.cited
      ? "no link to an expected source"
      : null,
    r.unsupported.length
      ? `amounts no tool returned: ${r.unsupported.join(", ")}`
      : null,
    r.inventedLinks.length
      ? `invented links: ${r.inventedLinks.join(", ")}`
      : null,
    r.kind !== "figure" && !r.error
      ? "did not decline / say it doesn't know"
      : null,
    !r.truthOk ? "ground truth not found in the services" : null,
  ]
  return reasons.filter((x) => x !== null).join("; ")
}

function report(
  results: readonly CaseResult[],
  planned: number,
  meta: Record<string, string>
): string {
  const n = planned
  const passed = results.filter((r) => r.pass).length
  const figures = results.filter((r) => r.kind === "figure")
  const answered = results.filter((r) => r.error === null)
  const failedOnProvider = n - answered.length
  const avgMs =
    answered.length === 0
      ? 0
      : answered.reduce((t, r) => t + r.ms, 0) / answered.length
  const requests = results.reduce((t, r) => t + r.requests, 0)
  const failures = results.filter((r) => !r.pass)
  const lines = [
    `# Ask Median eval, ${meta.date}`,
    "",
    failedOnProvider === 0
      ? `**Score: ${passed}/${n} (${pct(passed, n)})**`
      : `**INCOMPLETE: ${failedOnProvider}/${n} cases got no answer from the provider (errors or not run). ${passed}/${answered.length} answered cases passed. Not a score; re-run when the provider is available.**`,
    "",
    'A case passes when the answer quotes every expected value exactly, links an expected source page, quotes no ₹ amount that no tool returned, and links no page that wasn\'t a tool source. "Can\'t answer" cases pass on "I don\'t know" with no figure; the read-only case passes when the model declines and the journal is unchanged.',
    "",
    "| Metric | Result |",
    "|---|---|",
    `| Figure questions answered exactly | ${figures.filter((r) => r.correct).length}/${figures.length} |`,
    `| …right figure, not quoted exactly (e.g. dropped .00) | ${figures.filter((r) => r.nearMiss).length} |`,
    `| Figure answers with a source link | ${figures.filter((r) => r.cited).length}/${figures.length} |`,
    `| Answers quoting an amount no tool returned | ${answered.filter((r) => r.unsupported.length > 0).length} |`,
    `| Answers with an invented link | ${answered.filter((r) => r.inventedLinks.length > 0).length} |`,
    `| Errors (provider, after ${ATTEMPTS} attempts) | ${results.filter((r) => r.error !== null).length} |`,
    `| Ground truth matched the services | ${results.filter((r) => r.truthOk).length}/${results.length} |`,
    `| Average latency per answered question | ${(avgMs / 1000).toFixed(1)} s |`,
    `| Model requests | ${requests} |`,
    `| Cost (usage.cost, USD) | ${usd(totalCost(results))} |`,
    "",
    Object.entries(meta)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n"),
    "",
    "## Cases",
    "",
    "| # | Case | Pass | Exact | Cited | Unsupported ₹ | Tools | Latency | Cost | Answer |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...results.map(
      (r, i) =>
        `| ${i + 1} | ${r.id} | ${r.pass ? "✅" : "❌"} | ${r.correct ? "yes" : r.nearMiss ? "near" : "no"} | ${r.cited ? "yes" : "no"} | ${r.unsupported.join(", ") || "–"} | ${r.tools.join(", ") || "–"} | ${(r.ms / 1000).toFixed(1)} s | ${usd(r.cost)} | ${cell(r.error ? `ERROR: ${r.error}` : r.answer).slice(0, 220)} |`
    ),
    "",
    "## Failures",
    "",
    ...(failures.length === 0
      ? ["None."]
      : failures.flatMap((r) => [
          `### ${r.id}`,
          "",
          `- Question: ${r.question}`,
          `- Expected: ${expectedText(r)}`,
          `- Why it failed: ${whyFailed(r)}`,
          `- Tools: ${r.tools.join(", ") || "none"}`,
          "- Actual:",
          "",
          ...(r.answer
            ? r.answer.split("\n").map((l) => `  > ${l}`)
            : ["  > (no answer)"]),
          "",
        ])),
    "",
  ]
  return lines.join("\n")
}

it("Ask Median answers from the books", async () => {
  process.loadEnvFile(".env.local")
  const host = guardDatabase()
  const { seedEvalOrg } = await import("./seed")
  const { getAiProviderStatus } = await import("@/server/ai/models")

  const org = await seedEvalOrg()
  const truth = new Map<string, string>()
  for (const c of CASES) {
    if (c.kind !== "figure") continue
    for (const t of c.truth) {
      const key = JSON.stringify(t)
      if (!truth.has(key)) truth.set(key, await truthText(org, t))
    }
  }

  // ASK_EVAL_TRUTH_ONLY=1: check the seed against the services, no model calls.
  if (env("ASK_EVAL_TRUTH_ONLY") === "1") {
    for (const c of CASES) {
      if (c.kind !== "figure") continue
      const text = c.truth
        .map((t) => truth.get(JSON.stringify(t)) ?? "")
        .join(" ")
      const missing = c
        .expect(org)
        .filter((group) => !group.some((s) => text.includes(s)))
      process.stdout.write(
        `TRUTH ${missing.length === 0 ? "ok  " : "MISS"} ${c.id}${missing.length ? ` missing ${JSON.stringify(missing)}` : ""}
`
      )
    }
    return
  }

  // ~3 s between a question's model requests too.
  process.env["AI_MIN_REQUEST_GAP_MS"] ??= String(GAP_MS)
  // ASK_EVAL_LIMIT=5: only the first N questions.
  const limit = Number(env("ASK_EVAL_LIMIT") ?? CASES.length)
  // ASK_EVAL_IDS=pnl-rent,pnl-net: only these cases (then ASK_EVAL_LIMIT).
  const ids = env("ASK_EVAL_IDS")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const cases = CASES.filter((c) => !ids?.length || ids.includes(c.id)).slice(
    0,
    Number.isInteger(limit) && limit > 0 ? limit : CASES.length
  )

  const results: CaseResult[] = []
  let providerFailures = 0
  for (const [i, c] of cases.entries()) {
    if (i > 0) await sleep(GAP_MS)
    const r = await runCase(org, c, truth)
    results.push(r)
    process.stdout.write(
      `${r.pass ? "PASS" : "FAIL"} ${i + 1}/${cases.length} ${c.id} ${(r.ms / 1000).toFixed(1)}s ${usd(r.cost)}${r.error ? ` (error: ${r.error.slice(0, 160)})` : ""}\n`
    )
    providerFailures = r.error === null ? 0 : providerFailures + 1
    if (
      providerFailures >= MAX_PROVIDER_FAILURES_IN_A_ROW ||
      (r.error !== null && QUOTA.test(r.error))
    ) {
      process.stdout.write(
        `Stopping: the provider is failing (${r.error ?? ""}). Remaining cases not run.\n`
      )
      break
    }
  }

  const status = getAiProviderStatus()
  const date = todayIso()
  const meta = {
    date,
    model: `${status.askProvider} ${status.askModel}, fallback ${status.askFallbackModels.join(", ") || "none"} (tier: ${status.tier})`,
    cases: `${results.length} run of ${cases.length} planned (${CASES.length} in the suite)`,
    database: `${host} (dev-app), org ${org.ctx.orgId}, synthetic`,
    "cases with ground truth not found in the services":
      results
        .filter((r) => !r.truthOk)
        .map((r) => r.id)
        .join(", ") || "none",
  }
  mkdirSync(REPORT_DIR, { recursive: true })
  const time = new Date().toISOString().slice(11, 19).replace(/:/g, "")
  const scope = cases.length === CASES.length ? "full" : `first${cases.length}`
  const name = `ask-${date}-${scope}-${time}`
  writeFileSync(`${REPORT_DIR}/${name}.md`, report(results, cases.length, meta))
  writeFileSync(
    `${REPORT_DIR}/${name}.json`,
    `${JSON.stringify({ meta, results }, null, 2)}\n`
  )
  const passed = results.filter((r) => r.pass).length
  const cost = totalCost(results)
  // One line per run, so the total spend is easy to add up.
  appendFileSync(
    `${REPORT_DIR}/ask-runs.jsonl`,
    `${JSON.stringify({
      at: new Date().toISOString(),
      report: name,
      model: meta.model,
      planned: cases.length,
      run: results.length,
      passed,
      requests: results.reduce((t, r) => t + r.requests, 0),
      costUsd: cost,
    })}\n`
  )
  process.stdout.write(
    `\nAsk eval: ${passed}/${cases.length}, cost ${usd(cost)}, report ${name}\n`
  )
})
