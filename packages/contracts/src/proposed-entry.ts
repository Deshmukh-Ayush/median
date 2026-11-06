// The entry waiting in the approval inbox. Stored in inbox_items.proposed_entry
// as JSON (ids only, amounts as integer-paise strings); returned to the app
// with account and party names joined in.

import type { Money } from "@workspace/ledger"
import { z } from "zod"

import { idSchema, isoDateSchema, moneyJsonSchema } from "./common"
import type { AccountType, IsoDate } from "./common"

/** A proposed line as stored. */
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

/** A proposed line as the app sees it: ids plus names, so no extra lookups. */
export interface ProposedLineView extends ProposedLine {
  readonly accountCode: string
  readonly accountName: string
  readonly accountType: AccountType
  /** Null when the line has no party. */
  readonly partyName: string | null
}

export interface ProposedEntryView {
  readonly entryDate: IsoDate
  readonly narration: string
  readonly lines: readonly ProposedLineView[]
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
