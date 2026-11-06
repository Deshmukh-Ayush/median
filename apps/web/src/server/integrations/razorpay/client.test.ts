import { describe, expect, it, vi } from "vitest"

import {
  PAGE_SIZE,
  RazorpayApiError,
  RazorpayAuthError,
  createRazorpayClient,
} from "./client"

const payment = (n: number) => ({
  id: `pay_${String(n).padStart(14, "0")}`,
  entity: "payment",
  amount: 118_000,
  currency: "INR",
  status: "captured",
  order_id: null,
  invoice_id: null,
  method: "upi",
  amount_refunded: 0,
  captured: true,
  description: null,
  email: "a@b.in",
  contact: null,
  notes: [],
  fee: 2_360,
  tax: 360,
  created_at: 1_793_000_000 + n,
  acquirer_data: { rrn: "123" },
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
const collection = (items: unknown[]) =>
  json({ entity: "collection", count: items.length, items })

const keys = () =>
  ({ type: "keys", keyId: "rzp_test_abc", keySecret: "shh-secret" }) as const
const noSleep = () => Promise.resolve()
const toUrl = (u: RequestInfo | URL) =>
  u instanceof URL ? u : new URL(typeof u === "string" ? u : u.url)
const window = { from: 1_793_000_000, to: 1_793_100_000 }

async function collect<T>(gen: AsyncGenerator<{ items: T[] }>): Promise<T[]> {
  const all: T[] = []
  for await (const page of gen) all.push(...page.items)
  return all
}

describe("Razorpay client", () => {
  it("paginates with skip/count until a short page, keeping unknown fields", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        collection(Array.from({ length: PAGE_SIZE }, (_, i) => payment(i)))
      )
      .mockResolvedValueOnce(collection([payment(PAGE_SIZE)]))
    const client = createRazorpayClient(keys, {
      fetch: fetchMock,
      sleep: noSleep,
    })
    const payments = await collect(client.payments(window))
    expect(payments).toHaveLength(PAGE_SIZE + 1)
    expect(payments[0]?.notes).toEqual({})
    expect(payments[0]?.["acquirer_data"]).toEqual({ rrn: "123" })
    const urls = fetchMock.mock.calls.map(([url]) => toUrl(url))
    expect(urls.map((u) => u.searchParams.get("skip"))).toEqual([
      "0",
      String(PAGE_SIZE),
    ])
    expect(urls[0]?.searchParams.get("count")).toBe(String(PAGE_SIZE))
  })

  it("sends Basic auth for test keys and Bearer for OAuth", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(collection([])))
    await createRazorpayClient(keys, { fetch: fetchMock }).ping()
    await createRazorpayClient(() => ({ type: "oauth", accessToken: "tok" }), {
      fetch: fetchMock,
    }).ping()
    const headers = fetchMock.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("authorization")
    )
    expect(headers[0]).toBe(
      `Basic ${Buffer.from("rzp_test_abc:shh-secret").toString("base64")}`
    )
    expect(headers[1]).toBe("Bearer tok")
  })

  it("treats 401 as reconnect-needed, without retrying", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      json(
        {
          error: {
            code: "BAD_REQUEST_ERROR",
            description: "Authentication failed",
          },
        },
        401
      )
    )
    const client = createRazorpayClient(keys, {
      fetch: fetchMock,
      sleep: noSleep,
    })
    await expect(client.ping()).rejects.toBeInstanceOf(RazorpayAuthError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retries 429 and 5xx, then gives up with a clean error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(collection([]))
    await createRazorpayClient(keys, {
      fetch: fetchMock,
      sleep: noSleep,
    }).ping()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const failing = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(json({}, 503)))
    const error: unknown = await createRazorpayClient(keys, {
      fetch: failing,
      sleep: noSleep,
    })
      .ping()
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RazorpayApiError)
    expect(failing).toHaveBeenCalledTimes(3)
    expect(String(error)).not.toContain("shh-secret")
  })

  it("reports Razorpay's error description and rejects malformed responses", async () => {
    const bad = vi.fn<typeof fetch>().mockResolvedValue(
      json(
        {
          error: {
            code: "BAD_REQUEST_ERROR",
            description: "from must be a timestamp",
          },
        },
        400
      )
    )
    await expect(
      createRazorpayClient(keys, { fetch: bad }).ping()
    ).rejects.toThrow("from must be a timestamp")
    const odd = vi
      .fn<typeof fetch>()
      .mockResolvedValue(collection([{ ...payment(1), amount: 10.5 }]))
    await expect(
      collect(createRazorpayClient(keys, { fetch: odd }).payments(window))
    ).rejects.toBeInstanceOf(RazorpayApiError)
  })

  it("retries network failures", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(collection([]))
    await createRazorpayClient(keys, {
      fetch: fetchMock,
      sleep: noSleep,
    }).ping()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
