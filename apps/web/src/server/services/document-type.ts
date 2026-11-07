// Detects an upload's type from its first bytes, so a file can't claim to be
// a PDF and be served as HTML. Only the types Median accepts are recognised.

export type DetectedType =
  "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "text/csv"

const starts = (b: Uint8Array, sig: readonly number[], at = 0) =>
  sig.every((byte, i) => b[at + i] === byte)

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

/**
 * The file's type from its magic bytes; text with no control bytes counts
 * as CSV when the name or claimed type says CSV. Null when unrecognised.
 */
export function detectDocumentType(
  head: Uint8Array,
  hint: { readonly fileName: string; readonly claimedType: string }
): DetectedType | null {
  if (starts(head, ascii("%PDF-"))) return "application/pdf"
  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png"
  if (starts(head, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (starts(head, ascii("RIFF")) && starts(head, ascii("WEBP"), 8))
    return "image/webp"
  const saysCsv =
    /\.csv$/i.test(hint.fileName) ||
    ["text/csv", "application/vnd.ms-excel"].includes(hint.claimedType)
  // Text: tab, LF, CR and printable bytes only (UTF-8 continuation bytes are
  // ≥ 0x80). Rejects binaries and HTML-ish markup is still just text, which
  // we only ever serve as text/csv with nosniff.
  const isText = head.every(
    (byte) => byte === 0x09 || byte === 0x0a || byte === 0x0d || byte >= 0x20
  )
  if (saysCsv && isText && head.length > 0) return "text/csv"
  return null
}
