import "server-only"

import { razorpayKeyCredentialsSchema } from "@workspace/contracts"
import { z } from "zod"

import type {
  ApiConnector,
  ConnectorCursor,
  SettlementLink,
  SyncBatch,
  SyncContext,
} from "../connector"
import { ConnectorAuthError, ConnectorError } from "../connector"
import { keyHint } from "../credentials"
import type { Secret } from "../credentials"
import {
  RazorpayApiError,
  RazorpayAuthError,
  createRazorpayClient,
} from "./client"
import type { RazorpayAuth, RazorpayClientOptions, ListWindow } from "./client"
import {
  istDate,
  paymentRecords,
  reconLinks,
  refundRecord,
  settlementRecord,
} from "./records"

/** First sync reaches this far back. */
export const INITIAL_LOOKBACK_SECONDS = 90 * 86_400
/**
 * Every sync re-reads this much before the cursor, so records that change
 * after creation (refunds turning processed, settlements processing) are
 * picked up. Re-reads are deduped by external id.
 */
export const REREAD_SECONDS = 3 * 86_400

const STREAMS = ["payments", "refunds", "settlements"] as const

function windowFor(
  cursor: ConnectorCursor | null,
  stream: string,
  now: number
): ListWindow {
  const saved = cursor?.[stream]
  const from =
    typeof saved === "number"
      ? Math.max(0, saved - REREAD_SECONDS)
      : now - INITIAL_LOOKBACK_SECONDS
  return { from, to: now }
}

/** Razorpay errors → connector errors the runner understands. */
async function translate<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof RazorpayAuthError)
      throw new ConnectorAuthError(
        "Razorpay rejected the credentials. Reconnect Razorpay."
      )
    if (error instanceof RazorpayApiError)
      throw new ConnectorError(`Razorpay: ${error.message}`)
    throw error
  }
}

async function* syncRazorpay(
  auth: () => RazorpayAuth,
  cursor: ConnectorCursor | null,
  now: Date,
  options: RazorpayClientOptions
): AsyncGenerator<SyncBatch> {
  const client = createRazorpayClient(auth, options)
  const to = Math.floor(now.getTime() / 1000)
  let next: ConnectorCursor = { ...(cursor ?? {}) }

  const pages = async function* <T>(
    gen: AsyncGenerator<{ items: T[] }>
  ): AsyncGenerator<T[]> {
    for (;;) {
      const step = await translate(() => gen.next())
      if (step.done) return
      yield step.value.items
    }
  }

  for (const stream of STREAMS) {
    const window = windowFor(cursor, stream, to)
    if (stream === "payments") {
      for await (const items of pages(client.payments(window)))
        yield {
          records: items.flatMap((p) => paymentRecords(p)),
          cursor: next,
        }
    } else if (stream === "refunds") {
      for await (const items of pages(client.refunds(window)))
        yield {
          records: items.map((r) => refundRecord(r)),
          cursor: next,
        }
    } else {
      const reconByDay = new Map<string, "available" | "unavailable">()
      for await (const items of pages(client.settlements(window))) {
        const links: SettlementLink[] = []
        for (const s of items) {
          const day = istDate(s.created_at)
          const key = `${day.year}-${day.month}-${day.day}`
          if (!reconByDay.has(key)) {
            reconByDay.set(key, "available")
            try {
              for await (const recon of client.reconForDay(day))
                links.push(...reconLinks(recon))
            } catch (error) {
              if (error instanceof RazorpayAuthError)
                throw new ConnectorAuthError(
                  "Razorpay rejected the credentials. Reconnect Razorpay."
                )
              if (!(error instanceof RazorpayApiError)) throw error
              // No recon access (or not available in this mode): infer and flag.
              reconByDay.set(key, "unavailable")
            }
          }
        }
        yield {
          records: items.map((s) => {
            const d = istDate(s.created_at)
            return settlementRecord(
              s,
              reconByDay.get(`${d.year}-${d.month}-${d.day}`) ?? "unavailable"
            )
          }),
          settlementLinks: links,
          cursor: next,
        }
      }
    }
    // A stream's window is read newest first; only a finished stream moves
    // its cursor.
    next = { ...next, [stream]: to }
    yield { records: [], cursor: next }
  }
}

export const razorpayOAuthCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  /** Razorpay account id of the connected merchant. */
  accountId: z.string().min(1),
  expiresAt: z.iso.datetime().nullable(),
})
type OAuthCredentials = z.infer<typeof razorpayOAuthCredentialsSchema>
type KeyCredentials = z.infer<typeof razorpayKeyCredentialsSchema>

/** Test hook: inject fetch for the Razorpay client. */
let clientOptions: RazorpayClientOptions = {}
export function setRazorpayClientOptionsForTests(
  o: RazorpayClientOptions
): void {
  clientOptions = o
}

export const razorpayTestKeysConnector: ApiConnector<KeyCredentials> = {
  info: {
    provider: "razorpay-test-keys",
    displayName: "Razorpay (test keys)",
    category: "payments",
    authType: "api_key",
    description: "Connect a Razorpay test account with API keys.",
    availability: "available",
    accepts: [],
    testModeOnly: true,
  },
  credentialsSchema: razorpayKeyCredentialsSchema,
  async testConnection(credentials: Secret<KeyCredentials>) {
    const auth = (): RazorpayAuth => ({ type: "keys", ...credentials.reveal() })
    await translate(() => createRazorpayClient(auth, clientOptions).ping())
    return { keyHint: keyHint(credentials.reveal().keyId), mode: "test" }
  },
  sync(ctx: SyncContext<KeyCredentials>, cursor) {
    const auth = (): RazorpayAuth => ({
      type: "keys",
      ...ctx.credentials.reveal(),
    })
    return syncRazorpay(auth, cursor, ctx.now, clientOptions)
  },
}

export const razorpayOAuthConnector: ApiConnector<OAuthCredentials> = {
  info: {
    provider: "razorpay",
    displayName: "Razorpay",
    category: "payments",
    authType: "oauth",
    description: "Payments, refunds, fees and settlements, read-only.",
    availability: "available",
    accepts: [],
    testModeOnly: false,
  },
  credentialsSchema: razorpayOAuthCredentialsSchema,
  async testConnection(credentials: Secret<OAuthCredentials>) {
    const auth = (): RazorpayAuth => ({
      type: "oauth",
      accessToken: credentials.reveal().accessToken,
    })
    await translate(() => createRazorpayClient(auth, clientOptions).ping())
    return { keyHint: keyHint(credentials.reveal().accountId), mode: "live" }
  },
  sync(ctx: SyncContext<OAuthCredentials>, cursor) {
    const auth = (): RazorpayAuth => ({
      type: "oauth",
      accessToken: ctx.credentials.reveal().accessToken,
    })
    return syncRazorpay(auth, cursor, ctx.now, clientOptions)
  },
}
