import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import {
  AA_NON_TEXT,
  AA_NORMAL_TEXT,
  contrastRatio,
} from "@workspace/ui/lib/contrast"
import {
  allColors,
  contrastPairs,
  tokenValue,
  uiContrastPairs,
} from "@workspace/ui/lib/tokens"

describe("contrastRatio", () => {
  it("matches known WCAG values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5)
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5)
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2)
  })
})

describe("design tokens meet WCAG AA", () => {
  it.each(contrastPairs.map((pair) => [pair.fg, pair.bg] as const))(
    "%s on %s is at least 4.5:1",
    (fg, bg) => {
      const ratio = contrastRatio(tokenValue(fg), tokenValue(bg))
      expect(
        ratio,
        `${fg} on ${bg} is ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
    }
  )

  it.each(uiContrastPairs.map((pair) => [pair.fg, pair.bg] as const))(
    "%s on %s is at least 3:1 (non-text, WCAG 1.4.11)",
    (fg, bg) => {
      const ratio = contrastRatio(tokenValue(fg), tokenValue(bg))
      expect(
        ratio,
        `${fg} on ${bg} is ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(AA_NON_TEXT)
    }
  )

  it("documents why the raw brand colour isn't a button fill", () => {
    const ratio = contrastRatio("#ffffff", tokenValue("--accent-brand"))
    expect(ratio).toBeLessThan(AA_NORMAL_TEXT)
  })
})

describe("tokens.ts matches globals.css", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../styles/globals.css", import.meta.url)),
    "utf8"
  )

  it.each(allColors.map((token) => [token.name, token.value] as const))(
    "%s is %s in globals.css",
    (name, value) => {
      const match = new RegExp(`^\\s*${name}:\\s*(#[0-9a-f]{6});`, "im").exec(
        css
      )
      expect(match?.[1]?.toLowerCase()).toBe(value)
    }
  )
})
