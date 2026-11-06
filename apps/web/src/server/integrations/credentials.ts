import "server-only"

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"
import { inspect } from "node:util"

import { ServiceError } from "@workspace/contracts"
import { z } from "zod"

// Connector credentials (API keys, OAuth tokens) are encrypted at rest with
// AES-256-GCM. Each ciphertext is bound to its organisation and provider
// (authenticated data), so a row copied to another org or provider won't
// decrypt. Decrypted values are wrapped in Secret, which never prints.

const VERSION = "v1"
const IV_BYTES = 12

/**
 * A decrypted credential. `reveal()` returns the value; logging, JSON or
 * string conversion shows "[redacted]".
 */
export class Secret<T> {
  readonly #value: T

  constructor(value: T) {
    this.#value = value
  }

  reveal(): T {
    return this.#value
  }

  toJSON(): string {
    return "[redacted]"
  }

  toString(): string {
    return "[redacted]"
  }

  [inspect.custom](): string {
    return "Secret([redacted])"
  }
}

/** What a ciphertext is bound to. */
export interface CredentialBinding {
  readonly orgId: string
  readonly provider: string
}

const keySchema = z
  .string({ error: "CREDENTIALS_ENCRYPTION_KEY is not set." })
  .transform((v) => Buffer.from(v, "base64"))
  .refine((key) => key.length === 32, {
    message:
      "CREDENTIALS_ENCRYPTION_KEY must be 32 bytes, base64 (openssl rand -base64 32).",
  })

function loadKey(): Buffer {
  const parsed = keySchema.safeParse(process.env.CREDENTIALS_ENCRYPTION_KEY)
  if (!parsed.success) {
    // Configuration error: deliberately not a ServiceError (not user-facing).
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid CREDENTIALS_ENCRYPTION_KEY."
    )
  }
  return parsed.data
}

/** Short fingerprint of the key, stored with each ciphertext to detect a key change. */
function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8)
}

function aad(binding: CredentialBinding): Buffer {
  return Buffer.from(
    `median:credentials:${VERSION}:${binding.orgId}:${binding.provider}`
  )
}

/**
 * Encrypts JSON-serialisable credentials for `connections.credentials_encrypted`.
 * Format: v1.<keyId>.<iv>.<tag>.<ciphertext> (base64url parts).
 */
export function encryptCredentials(
  value: unknown,
  binding: CredentialBinding
): string {
  const key = loadKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(aad(binding))
  const plaintext = Buffer.from(JSON.stringify(value), "utf8")
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    keyId(key),
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}

/**
 * Decrypts and validates credentials. Throws ServiceError("INTEGRATION") if
 * the ciphertext was tampered with, belongs to another org or provider, was
 * made with another key, or doesn't match `schema`. Never includes the
 * plaintext in errors.
 */
export function decryptCredentials<S extends z.ZodType>(
  stored: string,
  binding: CredentialBinding,
  schema: S
): Secret<z.output<S>> {
  const failed = () =>
    new ServiceError(
      "INTEGRATION",
      "Stored credentials can't be read. Reconnect this integration."
    )
  const parts = stored.split(".")
  if (parts.length !== 5 || parts[0] !== VERSION) throw failed()
  const [, storedKeyId = "", iv = "", tag = "", ciphertext = ""] = parts
  const key = loadKey()
  if (storedKeyId !== keyId(key)) throw failed()

  let json: unknown
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64url")
    )
    decipher.setAAD(aad(binding))
    decipher.setAuthTag(Buffer.from(tag, "base64url"))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ])
    json = JSON.parse(plaintext.toString("utf8"))
  } catch {
    throw failed()
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw failed()
  return new Secret(parsed.data)
}

/** Last four characters of a key or account id, for display only. */
export function keyHint(id: string): string {
  return `…${id.slice(-4)}`
}
