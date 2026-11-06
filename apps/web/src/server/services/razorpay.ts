import "server-only"

import {
  ServiceError,
  completeRazorpayOAuthInputSchema,
  parseInput,
  startRazorpayOAuthInputSchema,
} from "@workspace/contracts"
import type {
  CompleteRazorpayOAuthInput,
  CompleteRazorpayOAuthResult,
  ConnectionSummary,
  StartRazorpayOAuthInput,
  StartRazorpayOAuthResult,
  SyncRazorpayResult,
} from "@workspace/contracts"
import { z } from "zod"

import { connect, listConnections, syncConnection } from "./connectors"
import { requireConsent } from "./consent"
import type { OrgContext } from "./context"
import { assertCan } from "./context"

/** App route that receives Razorpay's redirect and calls completeRazorpayOAuth. */
export const RAZORPAY_OAUTH_CALLBACK_PATH =
  "/api/integrations/razorpay/callback"

const stubStateSchema = z.object({ returnTo: z.string(), orgId: z.string() })

/**
 * Starts Razorpay partner OAuth (read-only scope): returns the approval-screen
 * URL to redirect to. Throws CONSENT_REQUIRED. STUB: the real version signs
 * `state` (org, user, nonce, expiry) and stores the nonce for single use.
 */
export async function startRazorpayOAuth(
  ctx: OrgContext,
  input: StartRazorpayOAuthInput = {}
): Promise<StartRazorpayOAuthResult> {
  assertCan(ctx, "settings", "update")
  const { returnTo } = parseInput(startRazorpayOAuthInputSchema, input)
  await requireConsent(ctx)
  const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
  const state = Buffer.from(
    JSON.stringify({ returnTo, orgId: ctx.orgId })
  ).toString("base64url")
  const url = new URL("https://auth.razorpay.com/authorize")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", "stub-partner-client-id")
  url.searchParams.set(
    "redirect_uri",
    new URL(RAZORPAY_OAUTH_CALLBACK_PATH, baseUrl).toString()
  )
  url.searchParams.set("scope", "read_only")
  url.searchParams.set("state", state)
  return {
    authorizeUrl: url.toString(),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  }
}

/**
 * Finishes Razorpay OAuth from the callback's query parameters: checks
 * `state`, exchanges the code for tokens (stored encrypted) and creates or
 * reconnects the connection. Throws VALIDATION (bad or expired state, or for
 * another organisation), INTEGRATION (user declined, or Razorpay refused the
 * code), CONSENT_REQUIRED. STUB.
 */
export async function completeRazorpayOAuth(
  ctx: OrgContext,
  input: CompleteRazorpayOAuthInput
): Promise<CompleteRazorpayOAuthResult> {
  assertCan(ctx, "settings", "update")
  const params = parseInput(completeRazorpayOAuthInputSchema, input)
  let state: z.infer<typeof stubStateSchema>
  try {
    const raw: unknown = JSON.parse(
      Buffer.from(params.state, "base64url").toString()
    )
    state = stubStateSchema.parse(raw)
  } catch {
    throw new ServiceError(
      "VALIDATION",
      "That Razorpay link has expired. Try connecting again."
    )
  }
  if (state.orgId !== ctx.orgId) {
    throw new ServiceError(
      "VALIDATION",
      "That Razorpay link was for another organisation."
    )
  }
  if ("error" in params) {
    throw new ServiceError(
      "INTEGRATION",
      params.error === "access_denied"
        ? "Razorpay access wasn't granted."
        : "Razorpay couldn't connect. Try again."
    )
  }
  await requireConsent(ctx)
  return {
    returnTo: state.returnTo,
    connection: {
      id: "00000000-0000-4000-8000-0000000000c1",
      provider: "razorpay",
      authType: "oauth",
      label: "Razorpay",
      keyHint: "…Xy9Q",
      mode: "live",
      ledgerAccountId: null,
      status: "connected",
      lastSyncedAt: null,
      lastError: null,
    },
  }
}

/**
 * @deprecated Live accounts connect with startRazorpayOAuth. For test mode use
 * `connect(ctx, "razorpay-test-keys", { keyId, keySecret })`.
 */
export async function connectRazorpay(
  ctx: OrgContext,
  keyId: string,
  keySecret: string
): Promise<ConnectionSummary> {
  return connect(ctx, "razorpay-test-keys", { keyId, keySecret })
}

/** @deprecated Use syncConnection(ctx, connectionId). */
export async function syncRazorpay(
  ctx: OrgContext
): Promise<SyncRazorpayResult> {
  const connection = (await listConnections(ctx)).find(
    (c) =>
      c.provider.startsWith("razorpay") &&
      c.authType !== "file" &&
      c.status !== "disconnected"
  )
  if (!connection)
    throw new ServiceError("NOT_FOUND", "Razorpay isn't connected.")
  const result = await syncConnection(ctx, connection.id)
  return {
    fetched: {
      payments: result.fetched.payment ?? 0,
      refunds: result.fetched.refund ?? 0,
      settlements: result.fetched.settlement ?? 0,
    },
    inserted: result.inserted,
    skippedExisting: result.skippedExisting,
    posted: result.posted,
    sentToInbox: result.sentToInbox,
    lastSyncedAt: result.lastSyncedAt,
  }
}
