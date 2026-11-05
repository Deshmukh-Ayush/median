import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The brand accent is rare by design: one primary button per view, plus the
 * logo. This test fails if an accent token shows up anywhere else in the app
 * or the design system, as a Tailwind class or as var(--accent-…).
 */

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url))
const scanRoots = ["packages/ui/src", "apps/web/src"]

/** Files allowed to reference the accent, and which lines within them. */
const allowed: Record<string, (line: string, previous: string) => boolean> = {
  // Definitions and the Tailwind mapping.
  "packages/ui/src/styles/globals.css": () => true,
  // Only the primary variant of Button.
  "packages/ui/src/components/button.tsx": (line, previous) =>
    /^\s*primary:/.test(line) || /^\s*primary:\s*$/.test(previous),
  // The logo mark.
  "packages/ui/src/components/logo.tsx": () => true,
}

const ACCENT_USE =
  /var\(--accent-(?:brand|button)|\b[a-z][a-z-]*-accent-(?:brand|button)(?:-hover)?\b/

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return /\.(tsx?|css|mdx?)$/.test(name) ? [path] : []
  })
}

function offenders(): string[] {
  const found: string[] = []
  for (const root of scanRoots) {
    for (const file of walk(join(repoRoot, root))) {
      const rel = relative(repoRoot, file).split(sep).join("/")
      if (rel.endsWith("accent-usage.test.ts")) continue
      const lines = readFileSync(file, "utf8").split("\n")
      lines.forEach((line, index) => {
        if (!ACCENT_USE.test(line)) return
        const isAllowed = allowed[rel]
        if (isAllowed?.(line, lines[index - 1] ?? "")) return
        found.push(`${rel}:${index + 1}: ${line.trim()}`)
      })
    }
  }
  return found
}

describe("accent usage", () => {
  it("appears only in Button's primary variant and the logo", () => {
    expect(offenders()).toEqual([])
  })

  it("is detected when misused", () => {
    expect(ACCENT_USE.test(`className="text-accent-brand"`)).toBe(true)
    expect(ACCENT_USE.test(`style={{ color: "var(--accent-button)" }}`)).toBe(
      true
    )
    expect(ACCENT_USE.test(`hover:bg-accent-button-hover`)).toBe(true)
    expect(
      ACCENT_USE.test(`className="bg-accent text-accent-foreground"`)
    ).toBe(false)
  })
})
