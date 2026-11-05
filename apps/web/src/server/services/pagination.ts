import "server-only"

import { ServiceError, cursorSchema } from "@workspace/contracts"
import type { Cursor } from "@workspace/contracts"

/** Opaque keyset cursor for `Page.nextCursor`. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

export function decodeCursor(cursor: string | null | undefined): Cursor | null {
  if (!cursor) return null
  try {
    const raw: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString())
    return cursorSchema.parse(raw)
  } catch {
    throw new ServiceError("VALIDATION", "Invalid page cursor.")
  }
}
