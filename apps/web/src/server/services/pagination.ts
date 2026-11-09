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

/**
 * Cursor key for lists ordered by a date, then creation time:
 * "<YYYY-MM-DD>|<ISO timestamp>". Throws VALIDATION if malformed.
 */
export function dateTimeCursorKey(k: string): { date: string; at: Date } {
  const [date = "", at = ""] = k.split("|")
  const parsed = new Date(at)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()))
    throw new ServiceError("VALIDATION", "Invalid page cursor.")
  return { date, at: parsed }
}
