import "server-only"

import type { ImportFile } from "@workspace/contracts"

import type { FileConnector, ParsedFile } from "../connector"
import { bankRowsToRecords, tableToBankRows, validateBankRows } from "./parse"

// Bank statements from any Indian bank. CSV is parsed here (papaparse,
// server-side); PDF statements arrive as rows from the AI module in the
// BankRow shape. One connection per bank account (connect with
// { label, ledgerAccountId }).

const PROVIDER = "bank-statement"

async function parseStatement(
  file: ImportFile,
  connectionId: string
): Promise<ParsedFile> {
  let parsed
  if (file.kind === "rows") {
    parsed = validateBankRows(file.rows)
  } else {
    // Heavy library: loaded on the server only, when a file arrives.
    const { default: Papa } = await import("papaparse")
    // Strip a UTF-8 byte-order mark (Excel exports).
    const text = file.text.startsWith("﻿") ? file.text.slice(1) : file.text
    const table = Papa.parse<string[]>(text, {
      skipEmptyLines: "greedy",
    })
    parsed = tableToBankRows(table.data)
  }
  const { records, rowIndexes } = bankRowsToRecords(
    PROVIDER,
    connectionId,
    parsed.rows
  )
  return { records, rowIndexes, errors: parsed.errors }
}

export const bankStatementConnector: FileConnector = {
  info: {
    provider: PROVIDER,
    displayName: "Bank statement",
    category: "banks",
    authType: "file",
    description: "CSV or PDF statements from any Indian bank.",
    availability: "available",
    accepts: ["text/csv", "application/pdf"],
    testModeOnly: false,
  },
  parseFile: (file, ctx) => parseStatement(file, ctx.connectionId),
}
