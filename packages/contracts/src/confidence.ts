/**
 * Confidence thresholds (0–1) for proposed entries. The UI's ConfidenceBadge
 * and the backend's auto-post rules both use these, so a "high" badge always
 * means the same thing as "safe to post without review".
 */

/** At or above: high confidence; deterministic rules may post directly. */
export const CONFIDENCE_HIGH = 0.9

/** At or above (and below CONFIDENCE_HIGH): medium; goes to the inbox. */
export const CONFIDENCE_MEDIUM = 0.7
