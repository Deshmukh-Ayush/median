import "server-only"

/**
 * Whether Razorpay runs in test mode, where the API-key form is offered.
 * Set RAZORPAY_MODE=live in production. Even in test mode the form only
 * accepts rzp_test_ keys; live accounts always connect with OAuth.
 */
export function isTestMode(): boolean {
  return process.env.RAZORPAY_MODE !== "live"
}

/** Upload cap, under the 5 MB server action body limit in next.config.ts. */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024
