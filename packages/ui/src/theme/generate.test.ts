import { describe, expect, it } from "vitest"

import { renderTokensCss } from "@workspace/ui/theme/css"
import { defaultThemeInputs, generateTheme } from "@workspace/ui/theme/generate"
import { contrastRatio } from "@workspace/ui/lib/contrast"

/**
 * The contrast-checked palette from design system v2. If the generator
 * drifts from any of these, this fails; change a value here only together
 * with a new contrast check (scripts/contrast.test.ts).
 */
const PINNED = {
  "--bg-canvas": "#f4f5f8",
  "--bg-sidebar": "#f4f5f8",
  "--bg-panel": "#ffffff",
  "--bg-subtle": "#f8f9fb",
  "--bg-hover": "#ecedf2",
  "--bg-selected": "#e4e6ee",
  "--bg-accent-soft": "#eef0fc",
  "--border-faint": "#ecedf1",
  "--border": "#e1e3e9",
  "--border-strong": "#d0d3db",
  "--border-input": "#8e929b",
  "--focus-ring": "#5e6ad2",
  "--text-title": "#111217",
  "--text": "#26272d",
  "--text-secondary": "#3f4350",
  "--text-tertiary": "#6b6f76",
  "--text-faint": "#8e929b",
  "--icon": "#7d818b",
  "--accent": "#5e6ad2",
  "--accent-hover": "#5560c8",
  "--accent-pressed": "#4d57bc",
  "--accent-text": "#5059c4",
  "--on-accent": "#ffffff",
  "--status-success": "#237a4b",
  "--status-success-soft": "#e9f6ef",
  "--status-success-dot": "#4cb782",
  "--status-warning": "#9a5b00",
  "--status-warning-soft": "#fdf3e3",
  "--status-warning-dot": "#e2a336",
  "--status-danger": "#c2383c",
  "--status-danger-soft": "#fdecec",
  "--status-danger-dot": "#e5484d",
  "--status-info": "#2b6cb0",
  "--status-info-soft": "#eaf2fb",
  "--status-info-dot": "#4c8fdb",
  "--status-neutral": "#3f4350",
  "--status-neutral-soft": "#ecedf2",
  "--status-neutral-dot": "#8e929b",
}

describe("generateTheme", () => {
  const theme = generateTheme(defaultThemeInputs)

  it("reproduces the pinned v2 palette from the default inputs", () => {
    expect(theme).toEqual(PINNED)
  })

  it("writes styles/tokens.css (npm run tokens to update)", async () => {
    await expect(renderTokensCss(theme)).toMatchFileSnapshot(
      "../styles/tokens.css"
    )
  })

  it("darkens text, not surfaces, as contrast rises", () => {
    const high = generateTheme({ ...defaultThemeInputs, contrast: 70 })
    const panel = theme["--bg-panel"]
    expect(high["--bg-canvas"]).toBe(theme["--bg-canvas"])
    expect(high["--bg-hover"]).toBe(theme["--bg-hover"])
    for (const ink of [
      "--text-tertiary",
      "--icon",
      "--border-input",
    ] as const) {
      expect(contrastRatio(high[ink], panel)).toBeGreaterThan(
        contrastRatio(theme[ink], panel)
      )
    }
  })

  it("moves every neutral with the base hue", () => {
    const warm = generateTheme({
      ...defaultThemeInputs,
      base: { ...defaultThemeInputs.base, h: 60, c: 0.008 },
    })
    expect(warm["--bg-canvas"]).not.toBe(theme["--bg-canvas"])
    expect(warm["--text-tertiary"]).not.toBe(theme["--text-tertiary"])
    expect(warm["--accent"]).toBe(theme["--accent"])
  })

  it("rejects contrast outside 0–100", () => {
    expect(() =>
      generateTheme({ ...defaultThemeInputs, contrast: 101 })
    ).toThrow()
  })
})
