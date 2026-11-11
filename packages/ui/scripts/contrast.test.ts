import { describe, expect, it } from "vitest"

import {
  AA_NON_TEXT,
  AA_NORMAL_TEXT,
  contrastRatio,
} from "@workspace/ui/lib/contrast"
import {
  contrastPairs,
  knownContrastGaps,
  tokenValue,
  uiContrastPairs,
} from "@workspace/ui/lib/tokens"
import type { ContrastPair } from "@workspace/ui/lib/tokens"

/**
 * WCAG contrast for every pair the design system allows. The ratio is in
 * each test's name, so `npm test -- --reporter=verbose` prints the table.
 */

function ratio({ fg, bg }: ContrastPair): number {
  return contrastRatio(tokenValue(fg), tokenValue(bg))
}

function rows(list: readonly ContrastPair[]) {
  return list.map(
    (pair) => [pair.fg, pair.bg, ratio(pair).toFixed(2), pair] as const
  )
}

describe("contrastRatio", () => {
  it("matches known WCAG values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5)
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5)
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2)
  })
})

describe("text, at least 4.5:1", () => {
  it.each(rows(contrastPairs))("%s on %s: %s", (_fg, _bg, _r, pair) => {
    expect(ratio(pair)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })
})

describe("UI boundaries and icons, at least 3:1", () => {
  it.each(rows(uiContrastPairs))("%s on %s: %s", (_fg, _bg, _r, pair) => {
    expect(ratio(pair)).toBeGreaterThanOrEqual(AA_NON_TEXT)
  })
})

describe("known gaps (not allowed in the UI)", () => {
  it.each(
    knownContrastGaps.map(
      (gap) => [gap.fg, gap.bg, ratio(gap).toFixed(2), gap] as const
    )
  )("%s on %s: %s", (_fg, _bg, _r, gap) => {
    // If this fails, the palette now passes: move the pair into the allowed
    // lists in lib/tokens.ts and drop the rule.
    expect(ratio(gap), gap.rule).toBeLessThan(gap.min)
  })
})
