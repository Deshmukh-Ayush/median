// A minimal .xlsx writer for report downloads: inline strings, exact money
// in rupees with Indian digit grouping, real dates, bold rows. Money is
// written from integer paise as decimal text, so no floats are involved.

import { zip } from "./zip"

export type XlsxCell =
  | string
  | null
  | { readonly money: bigint }
  | { readonly date: string }
  | { readonly bold: string }
  | { readonly boldMoney: bigint }

export interface XlsxSheet {
  /** At most 31 characters; []:*?/\ are replaced. */
  readonly name: string
  readonly rows: readonly (readonly XlsxCell[])[]
  /** Column widths in characters. */
  readonly widths?: readonly number[]
}

// Style indexes into cellXfs below.
const STYLE = { text: 0, bold: 1, money: 2, boldMoney: 3, date: 4 } as const

/** ₹1,23,45,678.90: lakh/crore grouping (negatives show a minus sign). */
const INDIAN_MONEY =
  "[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00"

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Control characters aren't allowed in XML 1.0.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")

/** Integer paise as exact rupees, e.g. -123456 → "-1234.56". */
export function rupeesText(paise: bigint): string {
  const negative = paise < 0n
  const abs = negative ? -paise : paise
  const text = `${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`
  return negative ? `-${text}` : text
}

/** Excel's serial day number for an ISO date (days since 1899-12-30). */
export function excelDate(iso: string): number {
  return Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000
  )
}

function columnName(index: number): string {
  let n = index + 1
  let name = ""
  while (n > 0) {
    const r = (n - 1) % 26
    name = String.fromCharCode(65 + r) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

function cellXml(cell: XlsxCell, ref: string): string {
  if (cell === null) return ""
  if (typeof cell === "string")
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`
  if ("bold" in cell)
    return `<c r="${ref}" s="${STYLE.bold}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.bold)}</t></is></c>`
  if ("money" in cell)
    return `<c r="${ref}" s="${STYLE.money}"><v>${rupeesText(cell.money)}</v></c>`
  if ("boldMoney" in cell)
    return `<c r="${ref}" s="${STYLE.boldMoney}"><v>${rupeesText(cell.boldMoney)}</v></c>`
  return `<c r="${ref}" s="${STYLE.date}"><v>${excelDate(cell.date)}</v></c>`
}

function sheetXml(sheet: XlsxSheet): string {
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths
        .map(
          (w, i) =>
            `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
        )
        .join("")}</cols>`
    : ""
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`))
        .join("")
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join("")
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="${escapeXml(INDIAN_MONEY)}"/><numFmt numFmtId="165" formatCode="dd-mm-yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`

const sheetName = (name: string, i: number) =>
  name
    .replace(/[[\]:*?/\\]/g, " ")
    .slice(0, 31)
    .trim() || `Sheet${i + 1}`

/** The workbook as .xlsx bytes. */
export function writeXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  if (sheets.length === 0) throw new Error("A workbook needs a sheet")
  const enc = new TextEncoder()
  const file = (name: string, text: string) => ({
    name,
    data: enc.encode(text),
  })
  const n = sheets.length
  return zip([
    file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join("")}</Types>`
    ),
    file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ),
    file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map(
          (s, i) =>
            `<sheet name="${escapeXml(sheetName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
        )
        .join("")}</sheets></workbook>`
    ),
    file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        )
        .join(
          ""
        )}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    ),
    file("xl/styles.xml", STYLES),
    ...sheets.map((s, i) =>
      file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s))
    ),
  ])
}
