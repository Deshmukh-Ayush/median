import { ServiceError } from "@workspace/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const services = vi.hoisted(() => ({ requireOrgContext: vi.fn() }))
vi.mock("@/server/services", () => services)

import type * as AskModule from "@/server/ai/ask/ask"

const askMock = vi.hoisted(() => vi.fn<typeof AskModule.ask>())
vi.mock("@/server/ai/ask/ask", async (importOriginal) => ({
  ...(await importOriginal<typeof AskModule>()),
  ask: askMock,
}))

const { POST } = await import("./route")
const { clearAskConversations, saveAskConversation } =
  await import("@/server/ai/ask/conversations")

const org = { orgId: "org_1", userId: "u1", role: "finance" } as const
const conversationId = "0f8c6a52-4a9e-4d9b-9a53-1f1c2a3b4c5d"

const body = (overrides: Record<string, unknown> = {}) => ({
  conversationId,
  message: {
    id: "m1",
    role: "user",
    parts: [{ type: "text", text: "What's my cash?" }],
  },
  ...overrides,
})

const post = (payload: unknown) =>
  POST(
    new Request("http://x/api/ask", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  )

/** A stream that ends at once: enough for the route to respond. */
function emptyResult(): ReturnType<typeof AskModule.ask> {
  // The route reads only .stream.
  // @ts-expect-error a partial StreamTextResult is enough here
  return Promise.resolve({
    stream: new ReadableStream({
      start(controller) {
        controller.close()
      },
    }),
  })
}

beforeEach(() => {
  services.requireOrgContext.mockReset().mockResolvedValue(org)
  askMock.mockReset().mockImplementation(emptyResult)
  clearAskConversations()
})
afterEach(() => vi.unstubAllEnvs())

describe("POST /api/ask", () => {
  it("401s without a session", async () => {
    services.requireOrgContext.mockRejectedValue(
      new ServiceError("UNAUTHENTICATED", "Please sign in.")
    )
    expect((await post(body())).status).toBe(401)
    expect(askMock).not.toHaveBeenCalled()
  })

  it("refuses in production on the AI free tier, before reading the books", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    vi.stubEnv("AI_PROVIDER_TIER", "free")
    const res = await post(body())
    expect(res.status).toBe(403)
    expect(askMock).not.toHaveBeenCalled()
  })

  it("400s on anything but one text question", async () => {
    for (const bad of [
      null,
      body({ conversationId: "nope" }),
      body({
        message: {
          id: "m1",
          role: "assistant",
          parts: [{ type: "text", text: "hi" }],
        },
      }),
      body({ message: { id: "m1", role: "user", parts: [] } }),
      body({ pageContext: { page: "https://evil.example" } }),
    ]) {
      expect((await post(bad)).status).toBe(400)
    }
    expect(askMock).not.toHaveBeenCalled()
  })

  it("takes history from the server's store, not the client", async () => {
    saveAskConversation(org, conversationId, [
      { id: "m0", role: "user", parts: [{ type: "text", text: "Earlier" }] },
    ])
    const res = await post(
      body({ pageContext: { page: "/gst", period: { month: "2026-10" } } })
    )
    expect(res.status).toBe(200)
    expect(askMock).toHaveBeenCalledTimes(1)
    const [ctx, input] = askMock.mock.calls[0] ?? []
    expect(ctx).toEqual(org)
    expect(input?.messages.map((m) => m.id)).toEqual(["m0", "m1"])
    expect(input?.pageContext).toEqual({
      page: "/gst",
      ids: [],
      period: { month: "2026-10" },
    })
  })
})
