/**
 * Median design tokens as data, for tests and the /design page. The values
 * come from the theme generator (theme/generate.ts), the same source as
 * styles/tokens.css, so the two can't drift.
 */

import { defaultThemeInputs, generateTheme } from "@workspace/ui/theme/generate"
import type { ColorTokenName } from "@workspace/ui/theme/generate"

export type TokenName = ColorTokenName

export interface ColorToken {
  readonly name: TokenName
  readonly value: `#${string}`
  readonly use: string
}

export const theme = generateTheme(defaultThemeInputs)

function group(
  tokens: readonly (readonly [TokenName, string])[]
): readonly ColorToken[] {
  return tokens.map(([name, use]) => ({ name, value: theme[name], use }))
}

export const surfaces = group([
  ["--bg-canvas", "Window behind the panel"],
  ["--bg-sidebar", "Sidebar: same as canvas, not a separate box"],
  ["--bg-panel", "Inset content panel, cards, inputs, menus"],
  ["--bg-subtle", "Table header, totals strip, properties panel"],
  ["--bg-hover", "Row and nav hover"],
  ["--bg-selected", "Selected row, active nav item"],
  ["--bg-accent-soft", "Multi-select row tint, accent badges"],
])

export const lines = group([
  ["--border-faint", "Row separators, sparingly"],
  ["--border", "Panel hairline, cards, dividers"],
  ["--border-strong", "Menus, popovers, segmented controls"],
  ["--border-input", "Input and checkbox outline, on --bg-panel only"],
  ["--focus-ring", "2px focus ring, 1px offset"],
])

export const text = group([
  ["--text-title", "Page titles, totals"],
  ["--text", "Body, table cells"],
  ["--text-secondary", "Labels, active sidebar items, text on hover"],
  [
    "--text-tertiary",
    "Meta, column headers, inactive nav. Not on hover or selected",
  ],
  ["--text-faint", "Placeholders and disabled only, never information"],
  ["--icon", "Decorative icons, 14–16px"],
])

export const accent = group([
  ["--accent", "Primary button, checked checkbox, focus ring"],
  ["--accent-hover", "Primary button hover"],
  ["--accent-pressed", "Primary button pressed"],
  ["--accent-text", "Links on white"],
  ["--on-accent", "Text on an accent fill"],
])

export const statusTones = [
  "success",
  "warning",
  "danger",
  "info",
  "neutral",
] as const
export type StatusTone = (typeof statusTones)[number]

const toneUse: Record<StatusTone, string> = {
  success: "Paid, reconciled",
  warning: "Due soon, needs review",
  danger: "Overdue, unbalanced, negative money",
  info: "Draft, synced",
  neutral: "Void",
}

export const status = group(
  statusTones.flatMap((tone) => [
    [`--status-${tone}`, `${toneUse[tone]}: text`] as const,
    [`--status-${tone}-soft`, "Pill background"] as const,
    [`--status-${tone}-dot`, "Dot beside a text label"] as const,
  ])
)

export const colorGroups = [
  { label: "Surfaces", tokens: surfaces },
  { label: "Lines", tokens: lines },
  { label: "Text", tokens: text },
  { label: "Accent", tokens: accent },
  { label: "Status", tokens: status },
] as const

export const allColors: readonly ColorToken[] = colorGroups.flatMap(
  (g) => g.tokens
)

export function tokenValue(name: TokenName): `#${string}` {
  return theme[name]
}

export interface ContrastPair {
  readonly fg: TokenName
  readonly bg: TokenName
}

const pairs = (
  fg: readonly TokenName[],
  bg: readonly TokenName[]
): ContrastPair[] => fg.flatMap((f) => bg.map((b) => ({ fg: f, bg: b })))

/**
 * Every text-on-background pair the design system allows; each must reach
 * WCAG AA for normal text (4.5:1). --text-faint is exempt (placeholders and
 * disabled controls, WCAG 1.4.3). --text-tertiary is left off --bg-hover and
 * --bg-selected on purpose: rows switch to --text-secondary there.
 */
export const contrastPairs: readonly ContrastPair[] = [
  ...pairs(
    ["--text-title", "--text", "--text-secondary"],
    [
      "--bg-panel",
      "--bg-canvas",
      "--bg-subtle",
      "--bg-hover",
      "--bg-selected",
      "--bg-accent-soft",
    ]
  ),
  ...pairs(["--text-tertiary"], ["--bg-panel", "--bg-canvas", "--bg-subtle"]),
  ...pairs(["--on-accent"], ["--accent", "--accent-hover", "--accent-pressed"]),
  ...pairs(
    ["--accent-text"],
    ["--bg-panel", "--bg-subtle", "--bg-accent-soft"]
  ),
  ...statusTones.flatMap((tone) =>
    pairs([`--status-${tone}`], [`--status-${tone}-soft`, "--bg-panel"])
  ),
  // Negative money is danger text in rows, including hovered ones.
  ...pairs(["--status-danger"], ["--bg-subtle", "--bg-hover"]),
]

/**
 * Non-text pairs that must reach 3:1 (WCAG 1.4.11): the outline that
 * identifies a field, the focus ring, the accent fill of a checked checkbox,
 * and icons that sit on every surface.
 */
export const uiContrastPairs: readonly ContrastPair[] = [
  { fg: "--border-input", bg: "--bg-panel" },
  ...pairs(["--focus-ring"], ["--bg-panel", "--bg-canvas", "--bg-subtle"]),
  { fg: "--accent", bg: "--bg-panel" },
  ...pairs(
    ["--icon"],
    ["--bg-panel", "--bg-canvas", "--bg-subtle", "--bg-hover", "--bg-selected"]
  ),
]

/**
 * Pairs the v2 palette doesn't support, kept here so the gap is explicit.
 * contrast.test.ts checks they're still below the bar, so fixing the palette
 * means moving them into the lists above.
 */
export const knownContrastGaps: readonly (ContrastPair & {
  readonly min: number
  readonly rule: string
})[] = [
  {
    fg: "--status-danger",
    bg: "--bg-selected",
    min: 4.5,
    rule: "Selected rows show negative money in --text-title with a minus sign",
  },
  {
    fg: "--border-input",
    bg: "--bg-canvas",
    min: 3,
    rule: "Inputs sit on --bg-panel only",
  },
  {
    fg: "--border-input",
    bg: "--bg-subtle",
    min: 3,
    rule: "Inputs sit on --bg-panel only",
  },
  ...(["success", "warning"] as const).map((tone) => ({
    fg: `--status-${tone}-dot` as const,
    bg: "--bg-panel" as const,
    min: 3,
    rule: "Dots are decorative: always next to a text label",
  })),
]

/** The v2 type ramp. Each is a `type-*` utility in globals.css. */
export const typeScale = [
  {
    className: "type-title-lg",
    spec: "24/30 · 600 · −0.4px · Display",
    use: "Page title",
  },
  {
    className: "type-title",
    spec: "18/24 · 600 · −0.2px · Display",
    use: "Detail header, dialog title",
  },
  {
    className: "type-heading",
    spec: "15/20 · 600 · −0.1px",
    use: "Section headers",
  },
  { className: "type-body", spec: "14/20 · 400", use: "Prose, forms" },
  {
    className: "type-ui",
    spec: "13/18 · 400/500",
    use: "Lists, sidebar, buttons, table cells",
  },
  {
    className: "type-caption",
    spec: "12/16 · 400/500",
    use: "Meta, column headers, pills",
  },
  {
    className: "type-amount-lg",
    spec: "28/34 · 600 · −0.6px · Display · tnum",
    use: "Dashboard KPI figures",
  },
] as const

export const radii = [
  { className: "rounded-sm", px: 4, use: "Checkbox, tags" },
  { className: "rounded-md", px: 6, use: "Buttons, inputs, nav items" },
  { className: "rounded-lg", px: 8, use: "Panel, cards, menus" },
  { className: "rounded-xl", px: 12, use: "Dialogs, command palette" },
] as const

export const spacing = [4, 8, 12, 16, 24, 32, 48] as const

export const motion = [
  { name: "--motion-fast", ms: 120, use: "Hover and press" },
  { name: "--motion-panel", ms: 160, use: "Menus and dialogs" },
] as const

export const density = [
  { name: "Button", px: 32 },
  { name: "Small button", px: 28 },
  { name: "Input", px: 32 },
  { name: "List row", px: 36 },
  { name: "Sidebar item", px: 28 },
  { name: "Top bar", px: 44 },
  { name: "Sidebar", px: 240 },
] as const
