import { oklchToHex } from "./oklch"
import type { Oklch } from "./oklch"

/**
 * Median's palette, generated from three inputs the way Linear's 2024
 * redesign does it: a base colour, an accent colour and a contrast level.
 * Every surface, line and text colour is a fixed OKLCH step from one of the
 * two colours, so they stay consistent with each other when an input moves.
 *
 * The steps were fitted to the contrast-checked palette in design system v2;
 * generate.test.ts pins the output to those hex values.
 */

export interface ThemeInputs {
  /** Canvas and sidebar colour; neutrals step from it. */
  readonly base: Oklch
  /** Brand colour; buttons, focus rings and links step from it. */
  readonly accent: Oklch
  /** 0–100. 30 is the default; higher pushes text and icons darker. */
  readonly contrast: number
}

/** #F4F5F8 and #5E6AD2. */
export const defaultThemeInputs: ThemeInputs = {
  base: { l: 0.9702, c: 0.0041, h: 271.4 },
  accent: { l: 0.5674, c: 0.1585, h: 275.2 },
  contrast: 30,
}

/**
 * A step from an input colour: lightness and hue are offsets, chroma is a
 * multiple (so a greyer base gives greyer neutrals). `ink` steps are text and
 * icons, which the contrast input pushes away from the white panel.
 */
interface Step {
  readonly l: number
  readonly c: number
  readonly h: number
  readonly ink?: true
}

const neutralSteps = {
  "--bg-canvas": { l: 0, c: 1.008, h: 0 },
  "--bg-sidebar": { l: 0, c: 1.008, h: 0 },
  "--bg-panel": { l: 0.03, c: 0, h: 0 },
  "--bg-subtle": { l: 0.012, c: 0.698, h: -6.9 },
  "--bg-hover": { l: -0.023, c: 1.653, h: 5.8 },
  "--bg-selected": { l: -0.044, c: 2.684, h: 3.5 },
  "--border-faint": { l: -0.024, c: 1.332, h: 3.6 },
  "--border": { l: -0.054, c: 2.049, h: -0.1 },
  "--border-strong": { l: -0.103, c: 2.798, h: -1.9 },
  "--border-input": { l: -0.311, c: 3.436, h: -4.8, ink: true },
  "--text-title": { l: -0.787, c: 2.52, h: 5, ink: true },
  "--text": { l: -0.696, c: 2.715, h: 6.7, ink: true },
  "--text-secondary": { l: -0.586, c: 5.549, h: 0.4, ink: true },
  "--text-tertiary": { l: -0.43, c: 2.911, h: -9.6, ink: true },
  "--text-faint": { l: -0.311, c: 3.436, h: -4.8 },
  "--icon": { l: -0.367, c: 3.865, h: -3, ink: true },
} as const satisfies Record<`--${string}`, Step>

const accentSteps = {
  "--accent": { l: 0, c: 1, h: 0 },
  "--accent-hover": { l: -0.032, c: 1.009, h: -0.1 },
  "--accent-pressed": { l: -0.063, c: 0.991, h: -0.2 },
  "--accent-text": { l: -0.052, c: 1.04, h: 0.2, ink: true },
  "--bg-accent-soft": { l: 0.39, c: 0.102, h: 3.3 },
  "--focus-ring": { l: 0, c: 1, h: 0 },
} as const satisfies Record<`--${string}`, Step>

/**
 * Status colours have fixed hues (green, amber, red, blue) and don't follow
 * the inputs, except that text darkens with contrast. Neutral status reuses
 * the neutral steps.
 */
const statusColors = {
  "--status-success": { l: 0.516, c: 0.1106, h: 155.2, ink: true },
  "--status-success-soft": { l: 0.9615, c: 0.0165, h: 162.8 },
  "--status-success-dot": { l: 0.7029, c: 0.1267, h: 158.9 },
  "--status-warning": { l: 0.531, c: 0.119, h: 65.1, ink: true },
  "--status-warning-soft": { l: 0.9677, c: 0.0237, h: 79.7 },
  "--status-warning-dot": { l: 0.7577, c: 0.1403, h: 76.7 },
  "--status-danger": { l: 0.548, c: 0.1746, h: 23.6, ink: true },
  "--status-danger-soft": { l: 0.9566, c: 0.0185, h: 17.5 },
  "--status-danger-dot": { l: 0.6256, c: 0.1933, h: 23 },
  "--status-info": { l: 0.5241, c: 0.1259, h: 252.3, ink: true },
  "--status-info-soft": { l: 0.9577, c: 0.0148, h: 251.2 },
  "--status-info-dot": { l: 0.6407, c: 0.1336, h: 253.1 },
} as const satisfies Record<`--${string}`, Step>

const neutralStatus = {
  "--status-neutral": "--text-secondary",
  "--status-neutral-soft": "--bg-hover",
  "--status-neutral-dot": "--text-faint",
} as const

export type ColorTokenName =
  | keyof typeof neutralSteps
  | keyof typeof accentSteps
  | keyof typeof statusColors
  | keyof typeof neutralStatus
  | "--on-accent"

export type Theme = Readonly<Record<ColorTokenName, `#${string}`>>

/** Pushes an ink colour's lightness away from white as contrast rises. */
function withContrast(l: number, contrast: number): number {
  const k = 1 + (contrast - 30) / 100
  return Math.min(1, Math.max(0, 1 - (1 - l) * k))
}

function resolve(from: Oklch, step: Step, contrast: number): `#${string}` {
  const l = from.l + step.l
  return oklchToHex({
    l: step.ink ? withContrast(l, contrast) : l,
    c: from.c * step.c,
    h: from.h + step.h,
  })
}

export function generateTheme({ base, accent, contrast }: ThemeInputs): Theme {
  if (contrast < 0 || contrast > 100) {
    throw new Error(`contrast must be 0–100, got ${contrast}`)
  }
  const fixed: Oklch = { l: 0, c: 1, h: 0 }
  const map = (
    steps: Record<string, Step>,
    from: Oklch
  ): Record<string, `#${string}`> =>
    Object.fromEntries(
      Object.entries(steps).map(([name, step]) => [
        name,
        resolve(from, step, contrast),
      ])
    )
  const neutrals = map(neutralSteps, base) as Record<
    keyof typeof neutralSteps,
    `#${string}`
  >
  return {
    ...neutrals,
    ...(map(accentSteps, accent) as Record<
      keyof typeof accentSteps,
      `#${string}`
    >),
    ...(map(statusColors, fixed) as Record<
      keyof typeof statusColors,
      `#${string}`
    >),
    "--status-neutral": neutrals[neutralStatus["--status-neutral"]],
    "--status-neutral-soft": neutrals[neutralStatus["--status-neutral-soft"]],
    "--status-neutral-dot": neutrals[neutralStatus["--status-neutral-dot"]],
    "--on-accent": "#ffffff",
  }
}
