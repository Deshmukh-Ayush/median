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
