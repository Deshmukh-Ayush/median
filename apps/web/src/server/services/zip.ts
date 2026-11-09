import { deflateRawSync } from "node:zlib"

// A minimal ZIP writer (deflate, no ZIP64): enough for an organisation's
// data export. Files over 4 GiB or 65,535 entries are refused.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  readonly name: string
  readonly data: Uint8Array
}

/** Builds a zip archive; names are UTF-8 (general-purpose flag bit 11). */
export function zip(
  entries: readonly ZipEntry[],
  now: Date = new Date()
): Uint8Array {
  if (entries.length > 0xffff) throw new Error("Too many files for a zip")
  const time =
    ((now.getHours() << 11) |
      (now.getMinutes() << 5) |
      (now.getSeconds() >> 1)) &
    0xffff
  const date =
    (((now.getFullYear() - 1980) << 9) |
      ((now.getMonth() + 1) << 5) |
      now.getDate()) &
    0xffff
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const e of entries) {
    const name = enc.encode(e.name)
    const body = deflateRawSync(e.data)
    if (e.data.length > 0xffffffff || body.length > 0xffffffff)
      throw new Error("File too large for a zip")
    const crc = crc32(e.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true)
    local.setUint16(8, 8, true)
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, body.length, true)
    local.setUint32(22, e.data.length, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    locals.push(new Uint8Array(local.buffer), name, body)

    const central = new DataView(new ArrayBuffer(46))
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true)
    central.setUint16(6, 20, true)
    central.setUint16(8, 0x0800, true)
    central.setUint16(10, 8, true)
    central.setUint16(12, time, true)
    central.setUint16(14, date, true)
    central.setUint32(16, crc, true)
    central.setUint32(20, body.length, true)
    central.setUint32(24, e.data.length, true)
    central.setUint16(28, name.length, true)
    central.setUint32(42, offset, true)
    centrals.push(new Uint8Array(central.buffer), name)
    offset += 30 + name.length + body.length
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0)
  if (offset > 0xffffffff) throw new Error("Archive too large for a zip")
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)]
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** One CSV cell: bigints and numbers as is, dates ISO, objects as JSON. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return ""
  let s: string
  if (typeof value === "string") s = value
  else if (
    typeof value === "bigint" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    s = String(value)
  else if (value instanceof Date) s = value.toISOString()
  else
    s = JSON.stringify(value, (_k: string, v: unknown) =>
      typeof v === "bigint" ? String(v) : v
    )
  // Quote when needed; a leading = + - @ is prefixed so spreadsheets don't run it.
  if (/^[=+\-@]/.test(s) && typeof value === "string") s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** RFC 4180 CSV with a header row, CRLF line ends. */
export function toCsv(
  columns: readonly string[],
  rows: readonly Readonly<Record<string, unknown>>[]
): string {
  const lines = [columns.map(cell).join(",")]
  for (const r of rows) lines.push(columns.map((c) => cell(r[c])).join(","))
  return lines.join("\r\n") + "\r\n"
}
