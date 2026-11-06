import { createHash } from "node:crypto"

import { bankRowSchema } from "@workspace/contracts"
import type { BankRow, SourceRecordInput } from "@workspace/contracts"
import { parseRupees } from "@workspace/ledger"

// Bank statements → bank_line SourceRecords. Pure (papaparse is passed in so
// the heavy import stays dynamic in the connector).
//
// Rule 12 dedupe: key = sha256(account, date, amount, narration, running
// balance). Without a balance, an occurrence index separates identical
// (account, date, amount, narration) rows within the file, so re-uploading
// the same or an overlapping statement creates no duplicates.

export interface ParsedRows {
  readonly rows: readonly { readonly index: number; readonly row: BankRow }[]
  readonly errors: readonly {
    readonly index: number
    readonly message: string
  }[]
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

/** Indian statement dates → YYYY-MM-DD. Day first; null if unreadable. */
export function parseStatementDate(text: string): string | null {
  const v = text.trim()
  let y: number, m: number, d: number
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (match) {
    ;[y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  } else if (
    (match = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(v))
  ) {
    d = Number(match[1])
    m = Number(match[2])
    y = Number(match[3])
    if (y < 100) y += 2000
  } else if (
    (match =
      /^(\d{1,2})[\s\-/]([A-Za-z]{3})[A-Za-z]*[\s\-/,]+(\d{2}|\d{4})$/.exec(v))
  ) {
    d = Number(match[1])
    m = MONTHS[(match[2] ?? "").toLowerCase()] ?? 0
    y = Number(match[3])
    if (y < 100) y += 2000
  } else {
    return null
  }
  const date = new Date(Date.UTC(y, m - 1, d))
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  )
    return null
  return date.toISOString().slice(0, 10)
}

type Column =
  | "date"
  | "description"
  | "reference"
  | "debit"
  | "credit"
  | "amount"
  | "type"
  | "balance"

const HEADER_NAMES: readonly [Column, RegExp][] = [
  ["date", /^(txn |transaction |tran |posting |value )?date$|^date$/],
  [
    "description",
    /^(narration|description|particulars|remarks|transaction details|details)$/,
  ],
  [
    "reference",
    /^(chq\.? ?\/? ?ref\.? ?no\.?|ref(erence)?( no\.?)?|cheque( no\.?)?|chq( no\.?)?|utr( no\.?)?|transaction id)$/,
  ],
  [
    "debit",
    /^(withdrawal( amt\.?| amount)?( \(inr\))?|debit( amount)?( \(inr\))?|dr( amount)?)$/,
  ],
  [
    "credit",
    /^(deposit( amt\.?| amount)?( \(inr\))?|credit( amount)?( \(inr\))?|cr( amount)?)$/,
  ],
  ["amount", /^(amount|txn amount|transaction amount)( \(inr\))?$/],
  ["type", /^(dr ?\/ ?cr|cr ?\/ ?dr|type|debit\/credit)$/],
  [
    "balance",
    /^((closing |running |available )?balance( amt\.?)?( \(inr\))?)$/,
  ],
]

function columnOf(header: string): Column | null {
  const h = header.trim().toLowerCase().replace(/\s+/g, " ")
  return HEADER_NAMES.find(([, re]) => re.test(h))?.[0] ?? null
}

/** Finds the header row (banks put account details above it). */
function findHeader(
  table: readonly string[][]
): { index: number; columns: Map<Column, number> } | null {
  for (let i = 0; i < Math.min(table.length, 40); i++) {
    const columns = new Map<Column, number>()
    ;(table[i] ?? []).forEach((cell, c) => {
      const col = columnOf(cell)
      if (col && !columns.has(col)) columns.set(col, c)
    })
    const hasAmounts =
      (columns.has("debit") && columns.has("credit")) || columns.has("amount")
    if (columns.has("date") && columns.has("description") && hasAmounts)
      return { index: i, columns }
  }
  return null
}

const blank = (v: string | undefined) =>
  v === undefined || v.trim() === "" || /^-+$/.test(v.trim())
const clean = (v: string | undefined) =>
  blank(v)
    ? null
    : (v ?? "")
        .replaceAll(",", "")
        .replace(/\s*(cr|dr)\.?$/i, "")
        .trim()

/** CSV table (already split by papaparse) → BankRows; footer/summary lines are skipped. */
export function tableToBankRows(table: readonly string[][]): ParsedRows {
  const header = findHeader(table)
  if (!header)
    return {
      rows: [],
      errors: [
        {
          index: 0,
          message:
            "Couldn't find the date, narration and amount columns in this statement.",
        },
      ],
    }
  const get = (r: readonly string[], c: Column) => {
    const i = header.columns.get(c)
    return i === undefined ? undefined : r[i]
  }
  const rows: { index: number; row: BankRow }[] = []
  const errors: { index: number; message: string }[] = []
  table.slice(header.index + 1).forEach((r, index) => {
    const dateText = get(r, "date")
    if (r.every((c) => blank(c))) return
    // Summary/footer lines have no date (no digit in the date cell): skip.
    if (blank(dateText) || !/\d/.test(dateText ?? "")) return
    let debit = clean(get(r, "debit"))
    let credit = clean(get(r, "credit"))
    if (header.columns.has("amount")) {
      const amount = clean(get(r, "amount"))
      const type = (get(r, "type") ?? get(r, "amount") ?? "")
        .trim()
        .toLowerCase()
      const isDebit =
        /(^|\s)(dr|debit|d)\.?$/.test(type) || amount?.startsWith("-")
      const magnitude = amount?.replace(/^-/, "") ?? null
      debit = isDebit ? magnitude : null
      credit = isDebit ? null : magnitude
    }
    if (debit !== null && /^0+(\.0+)?$/.test(debit)) debit = null
    if (credit !== null && /^0+(\.0+)?$/.test(credit)) credit = null
    const row = {
      date: parseStatementDate(dateText ?? "") ?? (dateText ?? "").trim(),
      description: (get(r, "description") ?? "").trim(),
      reference: blank(get(r, "reference"))
        ? null
        : (get(r, "reference") ?? "").trim(),
      debit,
      credit,
      balance: clean(get(r, "balance"))?.replace(/^-/, "") ?? null,
    }
    rows.push({ index, row })
  })
  return validateRows(
    rows.map((r) => r.row),
    rows.map((r) => r.index),
    errors
  )
}

function validateRows(
  inputs: readonly unknown[],
  indexes: readonly number[],
  errors: { index: number; message: string }[] = []
): ParsedRows {
  const rows: { index: number; row: BankRow }[] = []
  inputs.forEach((input, i) => {
    const index = indexes[i] ?? i
    const parsed = bankRowSchema.safeParse(input)
    if (parsed.success) rows.push({ index, row: parsed.data })
    else {
      const issue = parsed.error.issues[0]
      errors.push({
        index,
        message: issue
          ? `${issue.path.join(".") || "row"}: ${issue.message}`
          : "Invalid row",
      })
    }
  })
  return { rows, errors }
}

/** Rows already extracted (PDF statements via the AI module). */
export function validateBankRows(inputs: readonly unknown[]): ParsedRows {
  return validateRows(
    inputs,
    inputs.map((_, i) => i)
  )
}

const sha256 = (parts: readonly string[]) =>
  createHash("sha256").update(parts.join("\u001f")).digest("hex")

/** Rule 12: BankRows → bank_line records with dedupe hashes. */
export function bankRowsToRecords(
  provider: string,
  /** The bank connection: identifies the account. */
  account: string,
  rows: ParsedRows["rows"]
): { records: SourceRecordInput[]; rowIndexes: number[] } {
  const occurrences = new Map<string, number>()
  const records: SourceRecordInput[] = []
  const rowIndexes: number[] = []
  for (const { index, row } of rows) {
    const inflow = row.credit !== null
    const amount = BigInt(parseRupees(row.credit ?? row.debit ?? "0"))
    const signed = String(inflow ? amount : -amount)
    const narration = row.description.replace(/\s+/g, " ").trim().toUpperCase()
    const balance =
      row.balance === null ? null : String(BigInt(parseRupees(row.balance)))
    let key: string[]
    if (balance !== null) {
      key = [account, row.date, signed, narration, balance]
    } else {
      const base = [account, row.date, signed, narration].join("\u001f")
      const n = (occurrences.get(base) ?? 0) + 1
      occurrences.set(base, n)
      key = [account, row.date, signed, narration, "", String(n)]
    }
    records.push({
      provider,
      kind: "bank_line",
      externalId: null,
      dedupeHash: sha256(key),
      // Midnight IST on the statement date.
      occurredAt: `${row.date}T00:00:00+05:30`,
      amountPaise: amount,
      direction: inflow ? "inflow" : "outflow",
      currency: "INR",
      reference: row.reference,
      settlementExternalId: null,
      payload: { ...row, rowIndex: index },
    })
    rowIndexes.push(index)
  }
  return { records, rowIndexes }
}
