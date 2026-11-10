import { inflateRawSync } from "node:zlib"

import { describe, expect, it } from "vitest"

import { crc32, toCsv, zip } from "./zip"

/** Reads our own archives back through the central directory. */
function unzip(archive: Uint8Array): Record<string, string> {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength
  )
  const endAt = archive.length - 22
  expect(view.getUint32(endAt, true)).toBe(0x06054b50)
  const count = view.getUint16(endAt + 10, true)
  let at = view.getUint32(endAt + 16, true)
  const out: Record<string, string> = {}
  const dec = new TextDecoder()
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50)
    const crc = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 20, true)
    const nameLen = view.getUint16(at + 28, true)
    const local = view.getUint32(at + 42, true)
    const name = dec.decode(archive.subarray(at + 46, at + 46 + nameLen))
    const localNameLen = view.getUint16(local + 26, true)
    const start = local + 30 + localNameLen
    const data = inflateRawSync(archive.subarray(start, start + size))
    expect(crc32(data)).toBe(crc)
    out[name] = dec.decode(data)
    at += 46 + nameLen
  }
  return out
}

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926)
  })

  it("round-trips files, including UTF-8 names", () => {
    const enc = new TextEncoder()
    const archive = zip([
      { name: "manifest.json", data: enc.encode('{"a":1}') },
      { name: "ledger/₹ entries.csv", data: enc.encode("x".repeat(10_000)) },
      { name: "empty.csv", data: new Uint8Array() },
    ])
    expect(unzip(archive)).toEqual({
      "manifest.json": '{"a":1}',
      "ledger/₹ entries.csv": "x".repeat(10_000),
      "empty.csv": "",
    })
  })
})

describe("toCsv", () => {
  it("quotes, escapes and formats values", () => {
    expect(
      toCsv(
        ["a", "b", "c", "d", "e"],
        [
          {
            a: 'He said "hi", ok',
            b: 123_45n,
            c: new Date("2026-11-10T00:00:00Z"),
            d: { x: 1n },
            e: null,
          },
          { a: "=SUM(A1)", b: "line\nbreak", c: true },
        ]
      )
    ).toBe(
      'a,b,c,d,e\r\n"He said ""hi"", ok",12345,2026-11-10T00:00:00.000Z,"{""x"":""1""}",\r\n\'=SUM(A1),"line\nbreak",true,,\r\n'
    )
  })
})
