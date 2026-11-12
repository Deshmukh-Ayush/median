import type { AnyOf } from "./cases"

/** Markdown links in an answer. */
export function linksIn(answer: string): string[] {
  return [...answer.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].flatMap((m) =>
    m[1] ? [m[1]] : []
  )
}

/** Rupee amounts as written: "₹1,23,456.00", "-₹500", "₹ 5,000". */
export function amountsIn(text: string): string[] {
  return [...text.matchAll(/₹\s?[\d,]+(?:\.\d+)?/g)].map((m) =>
    m[0].replace(/\s/g, "")
  )
}

export interface Scored {
  /** Every expected group matched exactly. */
  readonly correct: boolean
  /** Matched only after dropping ".00" or grouping (quoted, not exact). */
  readonly nearMiss: boolean
  /** A link to an expected source page. */
  readonly cited: boolean
  /** ₹ amounts in the answer that no tool returned: computed or made up. */
  readonly unsupported: readonly string[]
  /** Links that weren't in any tool's sources. */
  readonly inventedLinks: readonly string[]
}

const digits = (s: string) => s.replace(/[^\d]/g, "").replace(/00$/, "")

export function scoreFigure(input: {
  readonly answer: string
  readonly expect: readonly AnyOf[]
  readonly cite: readonly string[]
  /** Everything the tools returned this turn, as JSON text. */
  readonly toolText: string
  /** Every href the tools offered as a source. */
  readonly sourceHrefs: ReadonlySet<string>
}): Scored {
  const { answer } = input
  const correct = input.expect.every((group) =>
    group.some((s) => answer.includes(s))
  )
  const answerDigits = amountsIn(answer).map(digits)
  const nearMiss =
    !correct &&
    input.expect.every((group) =>
      group.some(
        (s) =>
          answer.includes(s) ||
          (s.includes("₹") && answerDigits.includes(digits(s)))
      )
    )
  const links = linksIn(answer)
  const cited = links.some((href) =>
    input.cite.some((prefix) =>
      prefix === "/" ? href === "/" : href.startsWith(prefix)
    )
  )
  return {
    correct,
    nearMiss,
    cited,
    unsupported: unsupportedAmounts(answer, input.toolText),
    inventedLinks: links.filter((href) => !input.sourceHrefs.has(href)),
  }
}

/** Amounts in the answer that appear in no tool output (with or without a minus). */
export function unsupportedAmounts(answer: string, toolText: string): string[] {
  return amountsIn(answer).filter((a) => !toolText.includes(a))
}

const DONT_KNOW =
  /\b(i\s+don'?t\s+know|i\s+do\s+not\s+know|don'?t\s+have|do\s+not\s+have|can'?t|cannot|not\s+able|unable|no\s+(?:data|information))\b/i

export function saysDontKnow(answer: string): boolean {
  return DONT_KNOW.test(answer)
}

const DECLINES =
  /\b(can'?t|cannot|unable|not\s+able|only\s+read|read-only|don'?t\s+have\s+(?:the\s+)?(?:ability|permission))\b/i

export function declines(answer: string): boolean {
  return DECLINES.test(answer)
}
