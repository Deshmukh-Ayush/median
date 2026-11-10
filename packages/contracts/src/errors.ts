export type ServiceErrorCode =
  | "UNAUTHENTICATED"
  | "NO_ACTIVE_ORGANIZATION"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "PERIOD_LOCKED"
  | "UNBALANCED"
  | "INTEGRATION"
  /** Connect, sync, import and AI extraction need recorded consent first. */
  | "CONSENT_REQUIRED"
  /**
   * Production is on the AI provider's free tier: imports, syncs, document
   * uploads and AI extraction refuse to run until AI_PROVIDER_TIER=paid.
   */
  | "PAID_AI_REQUIRED"

/**
 * The only error type services throw on purpose. Pages map `code` to UI;
 * `message` is safe to show to the user.
 */
export class ServiceError extends Error {
  override readonly name = "ServiceError"

  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError
}
