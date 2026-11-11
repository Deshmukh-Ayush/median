import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Guards for how tokens are used across the app and the design system:
 *
 * - The accent is rare by design: primary buttons, the logo and the focus
 *   ring. Links, checked checkboxes and the multi-select tint join the list
 *   as those components land; add each file below when it does.
 * - No raw colours outside the generated tokens.
 * - No v1 class names whose meaning changed in v2.
 */

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url))
const scanRoots = ["packages/ui/src", "apps/web/src"]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return /\.(tsx?|css|mdx?)$/.test(name) ? [path] : []
  })
}

const sources = scanRoots
  .flatMap((root) => walk(join(repoRoot, root)))
  .map((file) => ({
    rel: relative(repoRoot, file).split(sep).join("/"),
    lines: readFileSync(file, "utf8").split("\n"),
  }))
  .filter(({ rel }) => !/\.test\.ts$/.test(rel))

function offenders(
  pattern: RegExp,
  allowed: Record<string, (line: string, previous: string) => boolean>
): string[] {
  return sources.flatMap(({ rel, lines }) =>
    lines.flatMap((line, index) => {
      if (!pattern.test(line)) return []
      if (allowed[rel]?.(line, lines[index - 1] ?? "")) return []
      return [`${rel}:${index + 1}: ${line.trim()}`]
    })
  )
}

const ACCENT_USE =
  /var\(--(?:accent|on-accent|bg-accent-soft)(?:-[a-z]+)?\)|\b[a-z][a-z-]*-(?:on-)?brand(?:-(?:hover|pressed|text|soft))?\b|\b[a-z][a-z-]*-on-accent\b/

/** Files allowed to reference the accent, and which lines within them. */
const accentAllowed: Record<
  string,
  (line: string, previous: string) => boolean
> = {
  // Definitions, the Tailwind mapping and the focus ring.
  "packages/ui/src/styles/globals.css": () => true,
  "packages/ui/src/styles/tokens.css": () => true,
  // Only the primary variant of Button.
  "packages/ui/src/components/button.tsx": (line, previous) =>
    /^\s*primary:/.test(line) || /^\s*primary:\s*$/.test(previous),
  // The logo mark.
  "packages/ui/src/components/logo.tsx": () => true,
}

const RAW_COLOR = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b(?!-)/i

const rawColorAllowed: Record<string, () => boolean> = {
  // The generator and its output.
  "packages/ui/src/theme/generate.ts": () => true,
  "packages/ui/src/styles/tokens.css": () => true,
  // A printed tax invoice, rendered by @react-pdf: CSS variables don't reach
  // it, and it prints in black and greys rather than the screen palette.
  "apps/web/src/server/pdf/invoice-document.tsx": () => true,
}

/** v1 classes that would now quietly mean something else. */
const RETIRED = /(?<![-\w])(?:[a-z-]+:)*(?:border|divide)-subtle\b/

describe("token usage", () => {
  it("uses the accent only in the allowed places", () => {
    expect(offenders(ACCENT_USE, accentAllowed)).toEqual([])
  })

  it("has no raw colours outside the generated tokens", () => {
    expect(offenders(RAW_COLOR, rawColorAllowed)).toEqual([])
  })

  it("doesn't use border-subtle or divide-subtle (v2: border-faint)", () => {
    expect(offenders(RETIRED, {})).toEqual([])
  })

  it("detects misuse", () => {
    expect(ACCENT_USE.test(`className="text-brand-text"`)).toBe(true)
    expect(ACCENT_USE.test(`className="bg-brand"`)).toBe(true)
    expect(ACCENT_USE.test(`hover:bg-brand-hover`)).toBe(true)
    expect(ACCENT_USE.test(`className="text-on-accent"`)).toBe(true)
    expect(ACCENT_USE.test(`style={{ color: "var(--accent-text)" }}`)).toBe(
      true
    )
    expect(ACCENT_USE.test(`className="bg-accent text-fg"`)).toBe(false)
    expect(RAW_COLOR.test(`color: "#5e6ad2"`)).toBe(true)
    expect(RAW_COLOR.test(`fill="#fff"`)).toBe(true)
    expect(RAW_COLOR.test(`href="#main"`)).toBe(false)
    expect(RETIRED.test(`hover:border-subtle`)).toBe(true)
    expect(RETIRED.test(`var(--border-subtle)`)).toBe(false)
  })
})
