import { randomBytes } from "node:crypto"
import { inspect } from "node:util"

import { ServiceError } from "@workspace/contracts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import {
  Secret,
  decryptCredentials,
  encryptCredentials,
  keyHint,
} from "./credentials"

const schema = z.object({ keyId: z.string(), keySecret: z.string() })
const creds = { keyId: "rzp_test_ABCD1234", keySecret: "very-secret-value" }
const binding = { orgId: "org_1", provider: "razorpay-test-keys" }
const original = process.env.CREDENTIALS_ENCRYPTION_KEY

beforeEach(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64")
})
afterEach(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = original
})

describe("credential encryption", () => {
  it("round-trips and never stores the plaintext", () => {
    const stored = encryptCredentials(creds, binding)
    expect(stored).not.toContain("very-secret-value")
    expect(stored.startsWith("v1.")).toBe(true)
    expect(decryptCredentials(stored, binding, schema).reveal()).toEqual(creds)
  })

  it("uses a fresh IV each time", () => {
    expect(encryptCredentials(creds, binding)).not.toBe(
      encryptCredentials(creds, binding)
    )
  })

  it("won't decrypt for another org or provider", () => {
    const stored = encryptCredentials(creds, binding)
    expect(() =>
      decryptCredentials(stored, { ...binding, orgId: "org_2" }, schema)
    ).toThrow(ServiceError)
    expect(() =>
      decryptCredentials(stored, { ...binding, provider: "stripe" }, schema)
    ).toThrow(ServiceError)
  })

  it("detects tampering and a changed key", () => {
    const stored = encryptCredentials(creds, binding)
    const parts = stored.split(".")
    const body = parts[4] ?? ""
    parts[4] = (body[0] === "A" ? "B" : "A") + body.slice(1)
    expect(() => decryptCredentials(parts.join("."), binding, schema)).toThrow(
      ServiceError
    )
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64")
    expect(() => decryptCredentials(stored, binding, schema)).toThrow(
      ServiceError
    )
  })

  it("rejects credentials that don't match the schema, without echoing them", () => {
    const stored = encryptCredentials({ token: "leak-me" }, binding)
    try {
      decryptCredentials(stored, binding, schema)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError)
      expect(JSON.stringify(error) + String(error)).not.toContain("leak-me")
    }
  })

  it("refuses to run without a 32-byte key", () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY =
      Buffer.from("short").toString("base64")
    expect(() => encryptCredentials(creds, binding)).toThrow("32 bytes")
    delete process.env.CREDENTIALS_ENCRYPTION_KEY
    expect(() => encryptCredentials(creds, binding)).toThrow("not set")
  })
})

describe("Secret", () => {
  it("never prints its value", () => {
    const secret = new Secret(creds)
    for (const shown of [
      JSON.stringify({ secret }),
      String(secret),
      inspect(secret),
      inspect({ secret }),
    ]) {
      expect(shown).not.toContain("very-secret-value")
    }
    expect(secret.reveal().keySecret).toBe("very-secret-value")
  })
})

describe("keyHint", () => {
  it("shows only the last four characters", () => {
    expect(keyHint("rzp_test_ABCD1234")).toBe("…1234")
  })
})
