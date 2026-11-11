/**
 * A synthetic company for the Ask Median eval: "Lakshmi Analytics", a
 * Bengaluru SaaS startup with one month (October 2026) of books. Every name,
 * GSTIN and amount is invented. Seeded through the real services, so the
 * ledger, GST and reports are exactly what the app would produce.
 *
 * October 2026, by hand:
 *   Capital          ₹10,00,000.00 into the bank (1 Oct)
 *   Rent             ₹40,000.00     (3 Oct, paid from bank)
 *   Software         ₹12,000.00     (15 Oct, paid from bank)
 *   Salaries         ₹2,00,000.00   (31 Oct, paid from bank)
 *   Invoices (all unpaid, 18% GST):
 *     Acme Retail (KA, intra-state)   ₹50,000.00 + CGST ₹4,500.00 + SGST ₹4,500.00 = ₹59,000.00
 *     Zenith Foods (MH, inter-state)  ₹1,20,000.00 + ₹21,600.00 = ₹1,41,600.00
 *     Orbit Labs (KA, unregistered)   ₹30,000.00 + ₹5,400.00 = ₹35,400.00
 *   Revenue ₹2,00,000.00 · expenses ₹2,52,000.00 · net loss ₹52,000.00
 *   Output GST ₹36,000.00 (CGST ₹7,200.00, SGST ₹7,200.00, IGST ₹21,600.00)
 *   Receivables ₹2,36,000.00 · bank ₹7,48,000.00
 */
import { paise } from "@workspace/ledger"
import { and, eq, inArray } from "drizzle-orm"

import { freshDevOrg } from "../../devchecks/setup"
import { getDb } from "../../src/server/db"
import { ledgerAccounts } from "../../src/server/db/schema"
import { updateGstProfile } from "../../src/server/services/gst-profile"
import { createInvoice } from "../../src/server/services/invoices"
import { postManualEntry } from "../../src/server/services/ledger"
import { createParty } from "../../src/server/services/parties"
import type { OrgContext } from "../../src/server/services/context"

export interface EvalOrg {
  readonly ctx: OrgContext
  readonly invoices: {
    readonly acme: { readonly id: string; readonly number: string }
    readonly zenith: { readonly id: string; readonly number: string }
    readonly orbit: { readonly id: string; readonly number: string }
  }
  readonly parties: {
    readonly acme: string
    readonly zenith: string
    readonly orbit: string
    readonly cloudnine: string
  }
}

export const GSTIN = {
  org: "29AABCL1234A1Z4",
  acme: "29AACCA4321C1Z8",
  zenith: "27AAAFZ5678B1ZZ",
  cloudnine: "29AADCC2468D1ZR",
} as const

const CODES = ["1110", "3100", "5100", "5200", "5220"] as const
type Code = (typeof CODES)[number]

async function accountIds(orgId: string): Promise<Record<Code, string>> {
  const rows = await getDb()
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.organizationId, orgId),
        inArray(ledgerAccounts.code, [...CODES])
      )
    )
  const out: Partial<Record<Code, string>> = {}
  for (const row of rows) {
    const code = CODES.find((c) => c === row.code)
    if (code) out[code] = row.id
  }
  for (const code of CODES) {
    if (!out[code]) throw new Error(`Seeded chart has no account ${code}`)
  }
  return out as Record<Code, string>
}

function cashOut(
  date: string,
  narration: string,
  expense: string,
  bank: string,
  amount: bigint
) {
  return {
    entryDate: date,
    narration,
    lines: [
      { accountId: expense, debit: paise(amount), credit: paise(0n) },
      { accountId: bank, debit: paise(0n), credit: paise(amount) },
    ],
  }
}

/** A fresh synthetic org with October 2026's books. */
export async function seedEvalOrg(): Promise<EvalOrg> {
  const ctx = await freshDevOrg("ask-eval")
  await updateGstProfile(ctx, {
    legalName: "Lakshmi Analytics Private Limited",
    gstin: GSTIN.org,
    stateCode: "29",
    gstRegistered: true,
    compositionScheme: false,
    defaultGstRateBps: 1800,
  })
  const a = await accountIds(ctx.orgId)

  await postManualEntry(ctx, {
    entryDate: "2026-10-01",
    narration: "Share capital from founders",
    lines: [
      { accountId: a["1110"], debit: paise(10_00_000_00n), credit: paise(0n) },
      { accountId: a["3100"], debit: paise(0n), credit: paise(10_00_000_00n) },
    ],
  })
  await postManualEntry(
    ctx,
    cashOut(
      "2026-10-03",
      "Office rent, October",
      a["5200"],
      a["1110"],
      40_000_00n
    )
  )
  await postManualEntry(
    ctx,
    cashOut(
      "2026-10-15",
      "Cloud and SaaS tools",
      a["5220"],
      a["1110"],
      12_000_00n
    )
  )
  await postManualEntry(
    ctx,
    cashOut(
      "2026-10-31",
      "Salaries, October",
      a["5100"],
      a["1110"],
      2_00_000_00n
    )
  )

  const acme = await createParty(ctx, {
    kind: "customer",
    name: "Acme Retail",
    gstin: GSTIN.acme,
  })
  const zenith = await createParty(ctx, {
    kind: "customer",
    name: "Zenith Foods",
    gstin: GSTIN.zenith,
  })
  const orbit = await createParty(ctx, {
    kind: "customer",
    name: "Orbit Labs",
    stateCode: "29",
  })
  const cloudnine = await createParty(ctx, {
    kind: "vendor",
    name: "CloudNine Hosting",
    gstin: GSTIN.cloudnine,
  })

  const seats = (quantity: string, unitPrice: bigint) => ({
    description: "Analytics platform seats",
    hsnSac: "998314",
    quantity,
    unitPrice,
    gstRateBps: 1800 as const,
  })
  const acmeInvoice = await createInvoice(ctx, {
    partyId: acme.id,
    invoiceDate: "2026-10-05",
    dueDate: "2026-10-20",
    lines: [seats("10", 5_000_00n)],
  })
  const zenithInvoice = await createInvoice(ctx, {
    partyId: zenith.id,
    invoiceDate: "2026-10-12",
    dueDate: "2026-11-11",
    lines: [seats("1", 1_20_000_00n)],
  })
  const orbitInvoice = await createInvoice(ctx, {
    partyId: orbit.id,
    invoiceDate: "2026-10-25",
    dueDate: "2026-12-24",
    lines: [seats("2", 15_000_00n)],
  })

  const ref = (i: { id: string; number: string }) => ({
    id: i.id,
    number: i.number,
  })
  return {
    ctx,
    invoices: {
      acme: ref(acmeInvoice),
      zenith: ref(zenithInvoice),
      orbit: ref(orbitInvoice),
    },
    parties: {
      acme: acme.id,
      zenith: zenith.id,
      orbit: orbit.id,
      cloudnine: cloudnine.id,
    },
  }
}
