import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

export type CronAuthResult = "ok" | "unauthorized" | "not_configured"

const digest = (value: string) => createHash("sha256").update(value).digest()

/**
 * Checks a cron request's `Authorization: Bearer <CRON_SECRET>` header.
 * Vercel Cron sends this header itself once CRON_SECRET is set.
 *
 * Constant time: both sides are hashed to the same length before
 * timingSafeEqual, so neither the secret's length nor its prefix leaks.
 * Fails closed: without a configured secret every request is refused.
 */
export function checkCronAuth(
  authorization: string | null,
  secret: string | undefined = process.env.CRON_SECRET
): CronAuthResult {
  // A short secret is a misconfiguration, not a password to accept.
  if (!secret || secret.length < 16) return "not_configured"
  const expected = `Bearer ${secret}`
  return timingSafeEqual(digest(authorization ?? ""), digest(expected))
    ? "ok"
    : "unauthorized"
}
