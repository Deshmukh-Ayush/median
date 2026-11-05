import "server-only"

import { z } from "zod"

import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { timestampDaysAgo } from "./stub-data"
import { parseInput } from "./types"
import type { IsoTimestamp } from "./types"

export type ConnectionStatus = "active" | "error" | "disconnected"

export interface ConnectionSummary {
  readonly id: string
  readonly provider: "razorpay" | "bank"
  readonly label: string
  /** Last four characters of the key id, e.g. "…a1B2". */
  readonly keyHint: string | null
  readonly status: ConnectionStatus
  readonly lastSyncedAt: IsoTimestamp | null
  readonly lastError: string | null
}

export interface SyncRazorpayResult {
  readonly fetched: {
    readonly payments: number
    readonly refunds: number
    readonly settlements: number
  }
  /** New source records stored (re-runs skip existing external ids). */
  readonly inserted: number
  readonly skippedExisting: number
  /** Records posted directly by high-confidence rules. */
  readonly posted: number
  /** Records sent to the inbox for review. */
  readonly sentToInbox: number
  readonly lastSyncedAt: IsoTimestamp
}

const connectRazorpayInputSchema = z.object({
  keyId: z
    .string()
    .trim()
    .regex(
      /^rzp_(test|live)_[A-Za-z0-9]+$/,
      "Razorpay key id looks like rzp_live_…"
    ),
  keySecret: z.string().trim().min(10).max(100),
})

/**
 * Verifies the keys with a read-only Razorpay call, then stores them
 * encrypted. Throws INTEGRATION if Razorpay rejects them. STUB.
 */
export async function connectRazorpay(
  ctx: OrgContext,
  keyId: string,
  keySecret: string
): Promise<ConnectionSummary> {
  assertCan(ctx, "ledger", "post")
  const input = parseInput(connectRazorpayInputSchema, { keyId, keySecret })
  await Promise.resolve()
  return {
    id: crypto.randomUUID(),
    provider: "razorpay",
    label: input.keyId.startsWith("rzp_live_")
      ? "Razorpay live"
      : "Razorpay test",
    keyHint: `…${input.keyId.slice(-4)}`,
    status: "active",
    lastSyncedAt: null,
    lastError: null,
  }
}

/**
 * Pulls payments, refunds, settlements and fees since the last sync. Safe to
 * re-run. Throws NOT_FOUND if Razorpay isn't connected. STUB.
 */
export async function syncRazorpay(
  ctx: OrgContext
): Promise<SyncRazorpayResult> {
  assertCan(ctx, "ledger", "post")
  await Promise.resolve()
  return {
    fetched: { payments: 148, refunds: 3, settlements: 9 },
    inserted: 160,
    skippedExisting: 0,
    posted: 154,
    sentToInbox: 6,
    lastSyncedAt: new Date().toISOString(),
  }
}

/** Connections for the settings page. STUB. */
export async function listConnections(
  ctx: OrgContext
): Promise<readonly ConnectionSummary[]> {
  assertCan(ctx, "ledger", "read")
  await Promise.resolve()
  return [
    {
      id: "00000000-0000-4000-8000-0000000000c1",
      provider: "razorpay",
      label: "Razorpay live",
      keyHint: "…Xy9Q",
      status: "active",
      lastSyncedAt: timestampDaysAgo(0),
      lastError: null,
    },
  ]
}
