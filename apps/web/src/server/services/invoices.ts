import "server-only"

import {
  ServiceError,
  gstStateCodeSchema,
  idSchema,
  isoDateSchema,
  moneySchema,
  pageOptionsSchema,
  parseInput,
} from "@workspace/contracts"
import type {
  IsoDate,
  IsoTimestamp,
  Money,
  Page,
  PageOptions,
  PartyRef,
} from "@workspace/contracts"
import { paise } from "@workspace/ledger"
import { z } from "zod"

import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { STUB_PARTIES, daysAgo, timestampDaysAgo } from "./stub-data"

export type InvoiceStatus = "issued" | "partially_paid" | "paid" | "cancelled"

/** GST rates in basis points (18% = 1800). */
export const GST_RATES_BPS = [0, 25, 300, 500, 1200, 1800, 2800, 4000] as const

export interface InvoiceLine {
  readonly id: string
  readonly description: string
  readonly hsnSac: string
  /** Decimal string, up to 3 places: "1", "7.5". */
  readonly quantity: string
  readonly unitPrice: Money
  readonly gstRateBps: number
  readonly taxable: Money
  readonly cgst: Money
  readonly sgst: Money
  readonly igst: Money
  readonly total: Money
}

export interface Invoice {
  readonly id: string
  /** e.g. "INV/2026-27/0042" */
  readonly number: string
  /** e.g. "2026-27" */
  readonly financialYear: string
  readonly party: PartyRef
  readonly invoiceDate: IsoDate
  readonly dueDate: IsoDate
  readonly placeOfSupply: string
  /** intra = CGST + SGST, inter = IGST. */
  readonly supplyType: "intra" | "inter"
  readonly lines: readonly InvoiceLine[]
  readonly taxable: Money
  readonly cgst: Money
  readonly sgst: Money
  readonly igst: Money
  readonly total: Money
  readonly paid: Money
  readonly status: InvoiceStatus
  readonly notes: string | null
  readonly journalEntryId: string | null
  readonly createdAt: IsoTimestamp
}

export type InvoiceListItem = Omit<Invoice, "lines">

export const createInvoiceInputSchema = z
  .object({
    partyId: idSchema,
    invoiceDate: isoDateSchema,
    dueDate: isoDateSchema,
    placeOfSupply: gstStateCodeSchema,
    notes: z.string().trim().max(2000).nullish(),
    lines: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(500),
          hsnSac: z
            .string()
            .trim()
            .regex(/^\d{4,8}$/, "HSN/SAC is 4–8 digits"),
          quantity: z
            .string()
            .trim()
            .regex(/^\d+(\.\d{1,3})?$/, "Quantity like 1 or 7.5"),
          unitPrice: moneySchema.refine(
            (v) => v >= 0n,
            "Price can't be negative"
          ),
          gstRateBps: z.union(GST_RATES_BPS.map((r) => z.literal(r))),
        })
      )
      .min(1)
      .max(100),
  })
  .refine(
    (i) => i.dueDate >= i.invoiceDate,
    "Due date is before the invoice date"
  )
export type CreateInvoiceInput = z.input<typeof createInvoiceInputSchema>

const listInvoicesFiltersSchema = z.object({
  status: z.enum(["issued", "partially_paid", "paid", "cancelled"]).optional(),
  partyId: idSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
})
export type ListInvoicesFilters = z.input<typeof listInvoicesFiltersSchema>

// --- stub helpers (Day 4 moves the real GST maths into @workspace/ledger) ---

const STUB_ORG_STATE = "29"

function stubLine(
  description: string,
  hsnSac: string,
  quantity: string,
  unitPrice: bigint,
  gstRateBps: number,
  intra: boolean
): InvoiceLine {
  const [whole = "0", frac = ""] = quantity.split(".")
  const milli = BigInt(whole) * 1000n + BigInt(frac.padEnd(3, "0"))
  const taxable = (milli * unitPrice + 500n) / 1000n
  const tax = (taxable * BigInt(gstRateBps) + 5_000n) / 10_000n
  const cgst = intra ? tax / 2n : 0n
  const sgst = intra ? tax - cgst : 0n
  const igst = intra ? 0n : tax
  return {
    id: crypto.randomUUID(),
    description,
    hsnSac,
    quantity,
    unitPrice: paise(unitPrice),
    gstRateBps,
    taxable: paise(taxable),
    cgst: paise(cgst),
    sgst: paise(sgst),
    igst: paise(igst),
    total: paise(taxable + tax),
  }
}

function stubInvoice(
  id: string,
  number: string,
  party: PartyRef,
  placeOfSupply: string,
  invoiceDate: IsoDate,
  dueDate: IsoDate,
  lines: readonly InvoiceLine[],
  status: InvoiceStatus,
  notes: string | null
): Invoice {
  const sum = (pick: (l: InvoiceLine) => Money) =>
    paise(lines.reduce((s, l) => s + pick(l), 0n))
  const total = sum((l) => l.total)
  return {
    id,
    number,
    financialYear: "2026-27",
    party,
    invoiceDate,
    dueDate,
    placeOfSupply,
    supplyType: placeOfSupply === STUB_ORG_STATE ? "intra" : "inter",
    lines,
    taxable: sum((l) => l.taxable),
    cgst: sum((l) => l.cgst),
    sgst: sum((l) => l.sgst),
    igst: sum((l) => l.igst),
    total,
    paid: status === "paid" ? total : paise(0n),
    status,
    notes,
    journalEntryId: crypto.randomUUID(),
    createdAt: timestampDaysAgo(3),
  }
}

const stubInvoices: readonly Invoice[] = [
  stubInvoice(
    "00000000-0000-4000-8000-00000000a001",
    "INV/2026-27/0042",
    STUB_PARTIES.acme,
    "29",
    daysAgo(3),
    daysAgo(-27),
    [
      stubLine(
        "Median Growth plan, annual",
        "998314",
        "1",
        1_00_000_00n,
        1800,
        true
      ),
    ],
    "issued",
    null
  ),
  stubInvoice(
    "00000000-0000-4000-8000-00000000a002",
    "INV/2026-27/0041",
    STUB_PARTIES.zenith,
    "27",
    daysAgo(20),
    daysAgo(5),
    [
      stubLine(
        "Implementation services",
        "998313",
        "12.5",
        2_000_00n,
        1800,
        false
      ),
    ],
    "paid",
    "Thanks for your business."
  ),
  stubInvoice(
    "00000000-0000-4000-8000-00000000a003",
    "INV/2026-27/0040",
    STUB_PARTIES.acme,
    "29",
    daysAgo(45),
    daysAgo(15),
    [
      stubLine(
        "Median Starter plan, monthly",
        "998314",
        "3",
        15_000_00n,
        1800,
        true
      ),
    ],
    "issued",
    null
  ),
]

/**
 * Creates and posts a sales invoice: next number in the financial-year
 * series, CGST+SGST or IGST from the place of supply, receivable/revenue/
 * output GST entry. Throws PERIOD_LOCKED / NOT_FOUND (party). STUB.
 */
export async function createInvoice(
  ctx: OrgContext,
  input: CreateInvoiceInput
): Promise<Invoice> {
  assertCan(ctx, "ledger", "post")
  const i = parseInput(createInvoiceInputSchema, input)
  const intra = i.placeOfSupply === STUB_ORG_STATE
  const lines = i.lines.map((l) =>
    stubLine(
      l.description,
      l.hsnSac,
      l.quantity,
      l.unitPrice,
      l.gstRateBps,
      intra
    )
  )
  await Promise.resolve()
  return {
    ...stubInvoice(
      crypto.randomUUID(),
      "INV/2026-27/0043",
      STUB_PARTIES.acme,
      i.placeOfSupply,
      i.invoiceDate,
      i.dueDate,
      lines,
      "issued",
      i.notes ?? null
    ),
    createdAt: new Date().toISOString(),
  }
}

/** Returns null when the invoice doesn't exist in this organisation. STUB. */
export async function getInvoice(
  ctx: OrgContext,
  id: string
): Promise<Invoice | null> {
  assertCan(ctx, "ledger", "read")
  const invoiceId = parseInput(idSchema, id)
  await Promise.resolve()
  return stubInvoices.find((inv) => inv.id === invoiceId) ?? null
}

/** Newest first. STUB. */
export async function listInvoices(
  ctx: OrgContext,
  cursor: string | null,
  filters: ListInvoicesFilters = {},
  options: PageOptions = {}
): Promise<Page<InvoiceListItem>> {
  assertCan(ctx, "ledger", "read")
  const f = parseInput(listInvoicesFiltersSchema, filters)
  const { limit } = parseInput(pageOptionsSchema, options)
  if (f.from && f.to && f.from > f.to)
    throw new ServiceError("VALIDATION", "'from' is after 'to'.")
  const items = stubInvoices
    .filter(
      (inv) =>
        (!f.status || inv.status === f.status) &&
        (!f.partyId || inv.party.id === f.partyId)
    )
    .map(({ lines: _lines, ...rest }) => rest)
  await Promise.resolve()
  return { items: cursor ? [] : items.slice(0, limit), nextCursor: null }
}
