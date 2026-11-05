// The shape of an entry waiting in the approval inbox. Stored in
// inbox_items.proposed_entry as JSON, with amounts as integer-paise strings.

import { z } from "zod"

import type { IsoDate, Money } from "./types"
import { idSchema, isoDateSchema, moneyJsonSchema } from "./types"

export interface ProposedLine {
  readonly accountId: string
  readonly partyId: string | null
  readonly debit: Money
  readonly credit: Money
  readonly description: string | null
}

export interface ProposedEntry {
  readonly entryDate: IsoDate
  readonly narration: string
  readonly lines: readonly ProposedLine[]
}

/** Parses the JSON stored in inbox_items.proposed_entry. */
export const proposedEntryJsonSchema = z.object({
  entryDate: isoDateSchema,
  narration: z.string().min(1).max(500),
  lines: z
    .array(
      z.object({
        accountId: idSchema,
        partyId: idSchema.nullable(),
        debit: moneyJsonSchema,
        credit: moneyJsonSchema,
        description: z.string().max(500).nullable(),
      })
    )
    .min(2),
})

/** Encodes a ProposedEntry for jsonb (bigint → string). */
export function encodeProposedEntry(entry: ProposedEntry): unknown {
  return {
    ...entry,
    lines: entry.lines.map((l) => ({
      ...l,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
    })),
  }
}
