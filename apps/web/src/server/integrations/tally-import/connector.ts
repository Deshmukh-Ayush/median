import "server-only"

import { createHash } from "node:crypto"

import type { ImportFile, SourceRecordInput } from "@workspace/contracts"
import { paise } from "@workspace/ledger"

import type { FileConnector, ParsedFile } from "../connector"
import { readTally } from "./tally"
import { XmlError } from "./xml"

// Tally XML export (masters, vouchers or both) as a file connector. One
// connection per Tally company: record ids are scoped to the connection, so
// re-importing the same or an overlapping file stores nothing twice.
// Posting is services/tally-import.ts (accounts, parties, opening balances,
// vouchers, then the trial-balance check).

export const TALLY_PROVIDER = "tally-import"

const ist = (date: string) => `${date}T00:00:00+05:30`
const abs = (v: bigint) => (v < 0n ? -v : v)

function parseTallyFile(file: ImportFile, connectionId: string): ParsedFile {
  if (file.kind !== "text")
    return {
      records: [],
      errors: [{ index: 0, message: "Upload the Tally XML file itself." }],
    }
  let data
  try {
    data = readTally(file.text)
  } catch (e) {
    if (e instanceof XmlError)
      return {
        records: [],
        errors: [{ index: 0, message: `Not readable Tally XML: ${e.message}` }],
      }
    throw e
  }
  const firstDate = data.vouchers.map((v) => v.date).sort()[0]
  const asOf = ist(firstDate ?? new Date().toISOString().slice(0, 10))
  const base = {
    provider: TALLY_PROVIDER,
    dedupeHash: null,
    currency: "INR",
    reference: null,
    settlementExternalId: null,
  } as const
  // Names can be long; ids stay within 200 characters.
  const id = (kind: string, key: string) =>
    `${connectionId}:${kind}:${createHash("sha256").update(key.toLowerCase()).digest("hex").slice(0, 40)}`

  const records: SourceRecordInput[] = []
  for (const l of data.ledgers) {
    records.push({
      ...base,
      kind:
        l.nature === "debtor" || l.nature === "creditor" ? "party" : "account",
      externalId: id("ledger", l.name),
      occurredAt: asOf,
      amountPaise: paise(0n),
      direction: "inflow",
      payload: {
        name: l.name,
        parent: l.parent,
        nature: l.nature,
        gstin: l.gstin,
        company: data.company,
      },
    })
    if (l.openingPaise !== 0n)
      records.push({
        ...base,
        kind: "opening_balance",
        externalId: id("opening", l.name),
        occurredAt: asOf,
        amountPaise: paise(abs(l.openingPaise)),
        direction: l.openingPaise > 0n ? "inflow" : "outflow",
        payload: { ledger: l.name, debitPaise: String(l.openingPaise) },
      })
  }
  for (const v of data.vouchers) {
    const lines = v.lines.map((l) => ({
      ledger: l.ledger,
      debitPaise: String(l.amountPaise),
    }))
    const key =
      v.guid ??
      createHash("sha256")
        .update(JSON.stringify([v.date, v.type, v.number, lines]))
        .digest("hex")
    const debits = v.lines.reduce(
      (s, l) => (l.amountPaise > 0n ? s + l.amountPaise : s),
      0n
    )
    records.push({
      ...base,
      kind: "voucher",
      externalId: id("voucher", key),
      occurredAt: ist(v.date),
      amountPaise: paise(debits),
      direction: "inflow",
      reference: v.number || null,
      payload: {
        date: v.date,
        type: v.type,
        number: v.number,
        narration: v.narration,
        lines,
      },
    })
  }
  return { records, errors: data.errors }
}

export const tallyImportConnector: FileConnector = {
  info: {
    provider: TALLY_PROVIDER,
    displayName: "Import from Tally",
    category: "accounting",
    authType: "file",
    description:
      "Masters, opening balances and vouchers from a Tally XML export.",
    availability: "available",
    accepts: ["application/xml", "text/xml"],
    testModeOnly: false,
  },
  parseFile: (file, ctx) =>
    Promise.resolve(parseTallyFile(file, ctx.connectionId)),
}
