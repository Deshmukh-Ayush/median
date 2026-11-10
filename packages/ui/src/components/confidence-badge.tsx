import * as React from "react"
import { CONFIDENCE_HIGH, CONFIDENCE_MEDIUM } from "@workspace/contracts"

import {
  StatusChip,
  type StatusTone,
} from "@workspace/ui/components/status-chip"

type ConfidenceLevel = "high" | "medium" | "low"

const LEVELS: Record<ConfidenceLevel, { label: string; tone: StatusTone }> = {
  high: { label: "High confidence", tone: "success" },
  medium: { label: "Medium confidence", tone: "warning" },
  low: { label: "Low confidence", tone: "danger" },
}

/**
 * Maps a 0–1 model score to a level using the shared contract thresholds, so
 * a "high" badge means the same as the backend's auto-post rule.
 */
function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_HIGH) return "high"
  if (score >= CONFIDENCE_MEDIUM) return "medium"
  return "low"
}

/** How sure the AI is about an extraction or suggestion. */
function ConfidenceBadge({
  level,
  score,
  reason,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  level?: ConfidenceLevel
  /** 0–1. Shown as a percentage when given. */
  score?: number
  /** Why the AI is or isn't sure. Shown on hover, read by screen readers. */
  reason?: string
}) {
  const resolved =
    level ?? (score === undefined ? "low" : confidenceLevel(score))
  const { label, tone } = LEVELS[resolved]
  const percent =
    score === undefined
      ? null
      : `${Math.round(Math.min(1, Math.max(0, score)) * 100)}%`
  return (
    <StatusChip
      tone={tone}
      dot
      title={reason}
      aria-label={[label, percent, reason].filter(Boolean).join(", ")}
      {...props}
    >
      {label}
      {/* Full tone colour: at 80% opacity it failed WCAG AA contrast. */}
      {percent ? <span className="tabular">· {percent}</span> : null}
    </StatusChip>
  )
}

export { ConfidenceBadge, confidenceLevel }
export type { ConfidenceLevel }
