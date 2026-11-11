import { inflateRawSync } from "node:zlib"
import { describe, expect, it } from "vitest"

import { excelDate, rupeesText, writeXlsx } from "./xlsx"

/** File names and contents of a zip (local headers; enough for a test). */
function unzip(bytes: Uint8Array): Map<string, string> {
  const buf = Buffer.from(bytes)
  const out = new Map<string, string>()
  let at = 0
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8)
    const size = buf.readUInt32LE(at + 18)
    const nameLen = buf.readUInt16LE(at + 26)
    const extraLen = buf.readUInt16LE(at + 28)
    const name = buf.toString("utf8", at + 30, at + 30 + nameLen)
    const start = at + 30 + nameLen + extraLen
    const data = buf.subarray(start, start + size)
    out.set(name, (method === 8 ? inflateRawSync(data) : data).toString("utf8"))
    at = start + size
  }
  return out
}

describe("xlsx", () => {
  it("writes money exactly from paise, and dates as Excel serials", () => {
    expect(rupeesText(123_456_789_01n)).toBe("123456789.01")
    expect(rupeesText(-5n)).toBe("-0.05")
    expect(rupeesText(0n)).toBe("0.00")
    expect(excelDate("1900-03-01")).toBe(61)
    expect(excelDate("2026-04-01")).toBe(46113)
  })

  it("builds a workbook Excel can open", () => {
    const files = unzip(
      writeXlsx([
        {
          name: "P&L: FY 2026/27",
          widths: [40, 18],
          rows: [
            [{ bold: "Account" }, { bold: "Amount" }],
            ['Sales <B2B> & "more"', { money: 1_18_000_00n }],
            [{ date: "2026-04-01" }, { boldMoney: -2_50n }],
          ],
        },
      ])
    )
    expect([...files.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ])
    // Sheet names can't contain : or /.
    expect(files.get("xl/workbook.xml")).toContain('name="P&amp;L  FY 2026 27"')
    const sheet = files.get("xl/worksheets/sheet1.xml") ?? ""
    expect(sheet).toContain("Sales &lt;B2B&gt; &amp; &quot;more&quot;")
    expect(sheet).toContain('<c r="B2" s="2"><v>118000.00</v></c>')
    expect(sheet).toContain('<c r="A3" s="4"><v>46113</v></c>')
    expect(sheet).toContain('<c r="B3" s="3"><v>-2.50</v></c>')
    expect(sheet).toContain('<col min="1" max="1" width="40" customWidth="1"/>')
  })
})
