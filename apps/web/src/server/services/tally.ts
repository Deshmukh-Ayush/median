import "server-only"

import { z } from "zod"

import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { isoDateSchema, parseInput } from "./types"
import type { IsoDate } from "./types"

export interface TallyExport {
  readonly fileName: string
  /** Tally-importable XML (ENVELOPE with masters and vouchers), UTF-8. */
  readonly xml: string
  readonly ledgerCount: number
  readonly voucherCount: number
}

const rangeSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((r) => r.from <= r.to, "'from' is after 'to'")

/** STUB: a well-formed but empty Tally envelope. */
export async function exportTally(
  ctx: OrgContext,
  from: IsoDate,
  to: IsoDate
): Promise<TallyExport> {
  assertCan(ctx, "report", "export")
  const r = parseInput(rangeSchema, { from, to })
  await Promise.resolve()
  return {
    fileName: `median-tally-${r.from}-to-${r.to}.xml`,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC><REQUESTDATA/></IMPORTDATA></BODY>
</ENVELOPE>
`,
    ledgerCount: 0,
    voucherCount: 0,
  }
}
