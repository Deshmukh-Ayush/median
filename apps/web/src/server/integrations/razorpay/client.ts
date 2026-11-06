import "server-only"

import type { z } from "zod"

import {
  collectionSchema,
  razorpayErrorSchema,
  razorpayPaymentSchema,
  razorpayReconItemSchema,
  razorpayRefundSchema,
  razorpaySettlementSchema,
} from "./schemas"
import type {
  RazorpayPayment,
  RazorpayReconItem,
  RazorpayRefund,
  RazorpaySettlement,
} from "./schemas"

const API_BASE = "https://api.razorpay.com/v1"
/** Razorpay's maximum page size for list endpoints. */
export const PAGE_SIZE = 100
const MAX_ATTEMPTS = 3
const TIMEOUT_MS = 15_000

export type RazorpayAuth =
  | {
      readonly type: "keys"
      readonly keyId: string
      readonly keySecret: string
    }
  | { readonly type: "oauth"; readonly accessToken: string }

/** Razorpay rejected our credentials or token (401): reconnect needed. */
export class RazorpayAuthError extends Error {
  override readonly name = "RazorpayAuthError"
}

/** Any other Razorpay or network failure. Never contains credentials. */
export class RazorpayApiError extends Error {
  override readonly name = "RazorpayApiError"

  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null
  ) {
    super(message)
  }
}

export interface ListWindow {
  /** Unix seconds, inclusive. */
  readonly from: number
  /** Unix seconds, inclusive. */
  readonly to: number
}

export interface RazorpayClientOptions {
  readonly fetch?: typeof fetch
  /** Waits between retries; injectable for tests. */
  readonly sleep?: (ms: number) => Promise<void>
}

function authorization(auth: RazorpayAuth): string {
  if (auth.type === "oauth") return `Bearer ${auth.accessToken}`
  return `Basic ${Buffer.from(`${auth.keyId}:${auth.keySecret}`).toString("base64")}`
}

/**
 * A read-only Razorpay API client. Pass `() => secret.reveal()` for `getAuth`. Responses are validated with Zod; lists are
 * paginated with `skip`/`count`. Retries 429 and 5xx with backoff.
 */
export function createRazorpayClient(
  /** Called per request, so the decrypted secret isn't held by the client. */
  getAuth: () => RazorpayAuth,
  options: RazorpayClientOptions = {}
) {
  const fetchImpl = options.fetch ?? fetch
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  async function get<S extends z.ZodType>(
    path: string,
    params: Record<string, string | number>,
    schema: S
  ): Promise<z.output<S>> {
    const url = new URL(`${API_BASE}${path}`)
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, String(value))

    for (let attempt = 1; ; attempt++) {
      let response: Response
      try {
        response = await fetchImpl(url, {
          headers: {
            Authorization: authorization(getAuth()),
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(500 * 2 ** attempt)
          continue
        }
        throw new RazorpayApiError("Couldn't reach Razorpay.", null, null)
      }

      if (response.status === 401) {
        throw new RazorpayAuthError("Razorpay rejected the credentials.")
      }
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < MAX_ATTEMPTS
      ) {
        await sleep(500 * 2 ** attempt)
        continue
      }

      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const parsed = razorpayErrorSchema.safeParse(body)
        throw new RazorpayApiError(
          parsed.success
            ? parsed.data.error.description
            : `Razorpay returned ${response.status}.`,
          response.status,
          parsed.success ? parsed.data.error.code : null
        )
      }
      const parsed = schema.safeParse(body)
      if (!parsed.success) {
        throw new RazorpayApiError(
          `Unexpected Razorpay response for ${path}: ${parsed.error.issues[0]?.message ?? "invalid"}`,
          response.status,
          null
        )
      }
      return parsed.data
    }
  }

  /** Yields pages until Razorpay returns a short page. */
  async function* paginate<T extends z.ZodType>(
    path: string,
    window: ListWindow,
    item: T,
    startSkip = 0
  ): AsyncGenerator<{
    readonly items: z.output<T>[]
    readonly nextSkip: number
  }> {
    const schema = collectionSchema(item)
    for (let skip = startSkip; ; skip += PAGE_SIZE) {
      const page = await get(
        path,
        { from: window.from, to: window.to, count: PAGE_SIZE, skip },
        schema
      )
      yield { items: page.items, nextSkip: skip + page.items.length }
      if (page.items.length < PAGE_SIZE) return
    }
  }

  return {
    /** Cheap authenticated call to check credentials (testConnection). */
    async ping(): Promise<void> {
      await get(
        "/payments",
        { count: 1 },
        collectionSchema(razorpayPaymentSchema)
      )
    },
    payments: (
      window: ListWindow,
      skip = 0
    ): AsyncGenerator<{ items: RazorpayPayment[]; nextSkip: number }> =>
      paginate("/payments", window, razorpayPaymentSchema, skip),
    refunds: (
      window: ListWindow,
      skip = 0
    ): AsyncGenerator<{ items: RazorpayRefund[]; nextSkip: number }> =>
      paginate("/refunds", window, razorpayRefundSchema, skip),
    settlements: (
      window: ListWindow,
      skip = 0
    ): AsyncGenerator<{ items: RazorpaySettlement[]; nextSkip: number }> =>
      paginate("/settlements", window, razorpaySettlementSchema, skip),
    /**
     * Settlement reconciliation for one day (IST calendar date). Throws
     * RazorpayApiError with status 400/403 when the account lacks access;
     * callers then infer and flag (plan, Day 2.4).
     */
    async *reconForDay(date: { year: number; month: number; day: number }) {
      const schema = collectionSchema(razorpayReconItemSchema)
      for (let skip = 0; ; skip += PAGE_SIZE) {
        const page = await get(
          "/settlements/recon/combined",
          {
            year: date.year,
            month: date.month,
            day: date.day,
            count: PAGE_SIZE,
            skip,
          },
          schema
        )
        const items: RazorpayReconItem[] = page.items
        yield items
        if (page.items.length < PAGE_SIZE) return
      }
    },
  }
}

export type RazorpayClient = ReturnType<typeof createRazorpayClient>
