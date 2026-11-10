import { ServiceError } from "@workspace/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { OrgContext } from "./context"

const consent = vi.hoisted(() => ({ accepted: true }))
vi.mock("./consent", async () => {
  const { ServiceError: Err } = await import("@workspace/contracts")
  return {
    requireConsent: vi.fn(() => {
      if (!consent.accepted)
        throw new Err("CONSENT_REQUIRED", "Accept consent first.")
      return Promise.resolve()
    }),
  }
})

const { connect, countCsvRows, importFile, listConnectors, syncConnection } =
  await import("./connectors")
const { completeRazorpayOAuth, startRazorpayOAuth } = await import("./razorpay")
const { importBankRows } = await import("./bank")

const ctx: OrgContext = { orgId: "org_1", userId: "user_1", role: "owner" }
const razorpayConnection = "00000000-0000-4000-8000-0000000000c1"
const bankConnection = "00000000-0000-4000-8000-0000000000c2"
const csv = {
  kind: "text",
  fileName: "s.csv",
  mimeType: "text/csv",
  text: "a\nb\n",
} as const

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise
    return "ok"
  } catch (error) {
    return error instanceof ServiceError ? error.code : "other"
  }
}

beforeEach(() => {
  consent.accepted = true
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("consent gate", () => {
  it("blocks connect, sync, import and Razorpay OAuth until consent is recorded", async () => {
    consent.accepted = false
    expect(
      await codeOf(
        connect(ctx, "razorpay-test-keys", {
          keyId: "rzp_test_x",
          keySecret: "s".repeat(12),
        })
      )
    ).toBe("CONSENT_REQUIRED")
    expect(await codeOf(syncConnection(ctx, razorpayConnection))).toBe(
      "CONSENT_REQUIRED"
    )
    expect(
      await codeOf(
        importFile(ctx, "bank-statement", csv, { connectionId: bankConnection })
      )
    ).toBe("CONSENT_REQUIRED")
    expect(
      await codeOf(importBankRows(ctx, [], { bankAccountId: bankConnection }))
    ).toBe("CONSENT_REQUIRED")
  })
})

describe("paid-AI gate", () => {
  it("blocks sync and imports in production on a free-tier AI key", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    vi.stubEnv("AI_PROVIDER_TIER", "free")
    expect(await codeOf(syncConnection(ctx, razorpayConnection))).toBe(
      "PAID_AI_REQUIRED"
    )
    expect(
      await codeOf(
        importFile(ctx, "bank-statement", csv, { connectionId: bankConnection })
      )
    ).toBe("PAID_AI_REQUIRED")
    expect(
      await codeOf(importBankRows(ctx, [], { bankAccountId: bankConnection }))
    ).toBe("PAID_AI_REQUIRED")
  })
})

describe("connectors", () => {
  it("lists every gallery category it has, with coming-soon connectors", async () => {
    const connectors = await listConnectors()
    expect(new Set(connectors.map((c) => c.provider)).size).toBe(
      connectors.length
    )
    expect(connectors.find((c) => c.provider === "razorpay")).toMatchObject({
      authType: "oauth",
      availability: "coming_soon",
    })
    expect(
      connectors.find((c) => c.provider === "razorpay-settlement-report")
    ).toMatchObject({ authType: "file" })
    expect(connectors.some((c) => c.availability === "coming_soon")).toBe(true)
  })

  it("rejects OAuth and coming-soon connectors in connect()", async () => {
    expect(await codeOf(connect(ctx, "razorpay", {}))).toBe("VALIDATION")
    expect(await codeOf(connect(ctx, "shopify", {}))).toBe("VALIDATION")
    expect(await codeOf(connect(ctx, "nope", {}))).toBe("NOT_FOUND")
  })

  it("validates Razorpay keys and rejects live keys in test mode", async () => {
    const secret = "s".repeat(12)
    expect(
      await codeOf(
        connect(ctx, "razorpay-test-keys", {
          keyId: "rzp_live_abc123",
          keySecret: secret,
        })
      )
    ).toBe("VALIDATION")
    expect(
      await codeOf(connect(ctx, "razorpay-test-keys", { keyId: "rzp_test_a" }))
    ).toBe("VALIDATION")
    expect(
      await codeOf(
        connect(ctx, "razorpay-test-keys", {
          keyId: "rzp_test_a",
          keySecret: "x",
        })
      )
    ).toBe("VALIDATION")
  })

  it("validates bank statement connection details", async () => {
    expect(
      await codeOf(connect(ctx, "bank-statement", { label: "HDFC" }))
    ).toBe("VALIDATION")
  })

  it("doesn't count the header or a trailing newline as rows", () => {
    expect(countCsvRows("a\nb\n")).toBe(1)
    expect(countCsvRows("a\nb")).toBe(1)
    expect(countCsvRows("a\r\nb\r\nc\r\n\r\n")).toBe(2)
    expect(countCsvRows("a\n")).toBe(0)
    expect(countCsvRows("")).toBe(0)
  })

  it("needs a bank connection for bank statements", async () => {
    expect(await codeOf(importFile(ctx, "bank-statement", csv))).toBe(
      "VALIDATION"
    )
  })

  it("keeps read-only roles out of connection setup", async () => {
    expect(await codeOf(startRazorpayOAuth({ ...ctx, role: "ca" }))).toBe(
      "FORBIDDEN"
    )
  })
})

describe("Razorpay OAuth", () => {
  it("is coming soon: start and complete both refuse, settlement reports stay available", async () => {
    expect(await codeOf(startRazorpayOAuth(ctx))).toBe("VALIDATION")
    expect(
      await codeOf(completeRazorpayOAuth(ctx, { code: "abc", state: "x" }))
    ).toBe("VALIDATION")
    const connectors = await listConnectors()
    expect(
      connectors.find((c) => c.provider === "razorpay-settlement-report")
    ).toMatchObject({ availability: "available" })
  })

  // Re-enable when Razorpay approves the partner app and "razorpay" is
  // available again.
  it.skip("asks for read-only scope and returns to the app path it started from", async () => {
    const { authorizeUrl } = await startRazorpayOAuth(ctx, {
      returnTo: "/onboarding/connect",
    })
    const url = new URL(authorizeUrl)
    expect(url.origin).toBe("https://auth.razorpay.com")
    expect(url.searchParams.get("scope")).toBe("read_only")
    const state = url.searchParams.get("state") ?? ""
    const done = await completeRazorpayOAuth(ctx, { code: "abc", state })
    expect(done.returnTo).toBe("/onboarding/connect")
    expect(done.connection.status).toBe("connected")
  })

  it.skip("refuses external return paths, other orgs' state and declined access", async () => {
    expect(
      await codeOf(
        startRazorpayOAuth(ctx, { returnTo: "https://evil.example" })
      )
    ).toBe("VALIDATION")
    expect(
      await codeOf(startRazorpayOAuth(ctx, { returnTo: "//evil.example" }))
    ).toBe("VALIDATION")
    const { authorizeUrl } = await startRazorpayOAuth(ctx)
    const state = new URL(authorizeUrl).searchParams.get("state") ?? ""
    expect(
      await codeOf(
        completeRazorpayOAuth(
          { ...ctx, orgId: "org_2" },
          { code: "abc", state }
        )
      )
    ).toBe("VALIDATION")
    expect(
      await codeOf(
        completeRazorpayOAuth(ctx, { error: "access_denied", state })
      )
    ).toBe("INTEGRATION")
  })
})
