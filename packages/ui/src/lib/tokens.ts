/**
 * Median design tokens as data. The CSS variables in styles/globals.css are
 * what the app uses; this file mirrors them so tests can check contrast and
 * /design can show swatches. A test keeps the two in sync.
 */

export interface ColorToken {
  readonly name: `--${string}`
  readonly value: `#${string}`
  readonly use: string
}

export const surfaces = [
  { name: "--bg-app", value: "#f6f6f7", use: "Main content area" },
  { name: "--bg-sidebar", value: "#efeff0", use: "Sidebar" },
  {
    name: "--bg-surface",
    value: "#ffffff",
    use: "Cards, tables, panels, dialogs, menus, command bar",
  },
  {
    name: "--bg-hover",
    value: "#e9e9eb",
    use: "Hover on rows, sidebar items, ghost buttons",
  },
  {
    name: "--bg-selected",
    value: "#e2e2e5",
    use: "Selected sidebar item, selected row",
  },
] as const satisfies readonly ColorToken[]

export const text = [
  {
    name: "--text-primary",
    value: "#1c1c1f",
    use: "Body, headings, numbers",
  },
  { name: "--text-secondary", value: "#5f5f67", use: "Labels, metadata" },
  {
    name: "--text-tertiary",
    value: "#6b6b73",
    use: "Hints, timestamps. Not on hover or selected backgrounds",
  },
  { name: "--text-disabled", value: "#a1a1a8", use: "Disabled only" },
  {
    name: "--text-on-accent",
    value: "#ffffff",
    use: "Label on a primary button",
  },
] as const satisfies readonly ColorToken[]

export const borders = [
  { name: "--border-subtle", value: "#e6e6e8", use: "Dividers" },
  { name: "--border-default", value: "#dcdce0", use: "Cards, tables" },
  { name: "--border-input", value: "#8e8e96", use: "Input outlines" },
] as const satisfies readonly ColorToken[]

export const accent = [
  {
    name: "--accent-brand",
    value: "#6d78d5",
    use: "Logo mark and brand moments only",
  },
  {
    name: "--accent-button",
    value: "#5b66c9",
    use: "Primary button fill (one per view)",
  },
  {
    name: "--accent-button-hover",
    value: "#5560c2",
    use: "Primary button hover and pressed",
  },
] as const satisfies readonly ColorToken[]

export const status = [
  { name: "--status-success", value: "#1f7a4d", use: "Success text" },
  {
    name: "--status-success-subtle",
    value: "#e8f3ed",
    use: "Success background",
  },
  { name: "--status-warning", value: "#8a5300", use: "Warning text" },
  {
    name: "--status-warning-subtle",
    value: "#fbf1e1",
    use: "Warning background",
  },
  { name: "--status-danger", value: "#b42d2a", use: "Danger text" },
  {
    name: "--status-danger-subtle",
    value: "#fbeceb",
    use: "Danger background",
  },
  { name: "--status-info", value: "#1f6fb2", use: "Info text" },
  { name: "--status-info-subtle", value: "#e9f1f9", use: "Info background" },
] as const satisfies readonly ColorToken[]

export const colorGroups = [
  { label: "Surfaces", tokens: surfaces },
  { label: "Text", tokens: text },
  { label: "Borders", tokens: borders },
  { label: "Brand accent", tokens: accent },
  { label: "Status", tokens: status },
] as const

const colorList = [
  ...surfaces,
  ...text,
  ...borders,
  ...accent,
  ...status,
] as const

export const allColors: readonly ColorToken[] = colorList

export type TokenName = (typeof colorList)[number]["name"]

export function tokenValue(name: TokenName): `#${string}` {
  const token = allColors.find((t) => t.name === name)
  if (!token) throw new Error(`Unknown token ${name}`)
  return token.value
}

/**
 * Every text-on-background pair the design system allows. Each must meet
 * WCAG AA for normal text (4.5:1); contrast.test.ts fails otherwise.
 * --text-disabled is exempt (WCAG 1.4.3 excludes inactive components).
 * --text-tertiary is deliberately absent on --bg-hover and --bg-selected
 * (4.36 and 4.09); rows switch hints to --text-secondary there.
 */
export interface ContrastPair {
  readonly fg: TokenName
  readonly bg: TokenName
}

const neutralBackgrounds = [
  "--bg-app",
  "--bg-sidebar",
  "--bg-surface",
  "--bg-hover",
  "--bg-selected",
] as const satisfies readonly TokenName[]

export const contrastPairs: readonly ContrastPair[] = [
  ...neutralBackgrounds.map((bg) => ({ fg: "--text-primary" as const, bg })),
  ...neutralBackgrounds.map((bg) => ({ fg: "--text-secondary" as const, bg })),
  ...(["--bg-app", "--bg-sidebar", "--bg-surface"] as const).map((bg) => ({
    fg: "--text-tertiary" as const,
    bg,
  })),
  { fg: "--text-on-accent", bg: "--accent-button" },
  { fg: "--text-on-accent", bg: "--accent-button-hover" },
  ...(["success", "warning", "danger", "info"] as const).flatMap((tone) =>
    ([`--status-${tone}-subtle`, "--bg-surface", "--bg-app"] as const).map(
      (bg) => ({ fg: `--status-${tone}` as const, bg })
    )
  ),
  // Money in danger text can sit in hovered or selected rows.
  { fg: "--status-danger", bg: "--bg-hover" },
  { fg: "--status-danger", bg: "--bg-selected" },
]

/**
 * Non-text pairs that must meet WCAG 1.4.11 (3:1): the input outline is what
 * identifies a field, so it has to be visible on every surface a field sits on.
 */
export const uiContrastPairs: readonly ContrastPair[] = [
  { fg: "--border-input", bg: "--bg-surface" },
  { fg: "--border-input", bg: "--bg-app" },
]

export const typeScale = [
  { className: "text-2xs", px: 11, use: "Keyboard hints, dense metadata" },
  { className: "text-xs", px: 12, use: "Labels, chips, table headers" },
  { className: "text-sm", px: 13, use: "Default UI size" },
  { className: "text-base", px: 14, use: "Reading text" },
  { className: "text-md", px: 16, use: "Section headings" },
  { className: "text-lg", px: 20, use: "Stat values" },
  { className: "text-xl", px: 24, use: "Page titles (Inter Display)" },
] as const

export const radii = [
  { className: "rounded-sm", px: 4, use: "Inputs, chips" },
  { className: "rounded-md", px: 6, use: "Buttons, rows" },
  { className: "rounded-lg", px: 8, use: "Cards, dialogs" },
  { className: "rounded-xl", px: 12, use: "Sheets" },
] as const

export const spacing = [4, 8, 12, 16, 20, 24, 32, 40, 48] as const

export const motion = [
  { name: "--motion-fast", ms: 120, use: "Hover and press" },
  { name: "--motion-panel", ms: 180, use: "Panels, dialogs, sheets" },
] as const

export const density = [
  { name: "List row", px: 36 },
  { name: "Table row", px: 32 },
  { name: "Sidebar", px: 232 },
  { name: "Top bar", px: 48 },
] as const
