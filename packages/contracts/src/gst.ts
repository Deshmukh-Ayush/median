// GST: the monthly summary (GSTR-3B style) and the GSTR-1 draft export.

import { z } from "zod"

import type { Money, Period } from "./common"

export interface GstTaxAmounts {
  readonly igst: Money
  readonly cgst: Money
  readonly sgst: Money
  /** igst + cgst + sgst */
  readonly total: Money
}

/**
 * How a supply is reported. `taxable`: domestic B2B or B2C with GST charged
 * by us. `no_invoice`: sales booked from payments without an invoice (rule 8),
 * reported as B2C at the org's state.
 */
export type GstSupplyCategory =
  | "taxable"
  | "export_with_payment"
  | "export_lut"
  | "sez"
  | "reverse_charge"
  | "no_invoice"

export interface GstSupplyRow extends GstTaxAmounts {
  readonly category: GstSupplyCategory
  readonly rateBps: number
  readonly taxable: Money
  /** Invoices or credit notes in the row (0 for `no_invoice`). */
  readonly documentCount: number
}

/** GSTR-3B style summary for one month. */
export interface GstSummary {
  readonly period: Period
  readonly gstin: string | null
  /** Outward supplies by category and rate (invoices plus sales without one). */
  readonly outward: readonly GstSupplyRow[]
  /** Credit notes issued in the month, by category and rate (positive amounts). */
  readonly creditNotes: readonly GstSupplyRow[]
  /** Outward minus credit notes. */
  readonly outwardTotal: GstTaxAmounts & { readonly taxable: Money }
  /** Movement on the output GST accounts in the month: the liability as booked. */
  readonly outputTax: GstTaxAmounts
  /**
   * Output tax the rows above don't explain (e.g. a manual entry to an
   * output GST account). Zero when the books and the documents agree.
   */
  readonly unexplainedOutputTax: GstTaxAmounts
  /** Movement on the input GST accounts in the month. */
  readonly inputTaxCredit: GstTaxAmounts
  /** Cash to pay per head after the section 49 set-off. Never negative. */
  readonly netPayable: GstTaxAmounts
  /** Credit left after the set-off, carried to next month. */
  readonly creditCarriedForward: GstTaxAmounts
  /** TDS deducted by customers in the month (income tax, not GST; for reference). */
  readonly tdsReceivable: Money
  /** True once the month is locked (numbers can't change). */
  readonly isLocked: boolean
  readonly warnings: readonly string[]
}

// ---------------------------------------------------------------------------
// GSTR-1 (GSTN offline tool JSON). Amounts are rupees with at most two
// decimals, rates are percentages, dates are dd-mm-yyyy.

const rupees = z
  .number()
  .refine(
    (n) => Number.isFinite(n) && Math.round(n * 100) / 100 === n,
    "at most two decimals"
  )
const rate = z.number().min(0).max(100)
const gstin = z.string().regex(/^[0-9]{2}[0-9A-Z]{10}[0-9A-Z]Z[0-9A-Z]$/)
const pos = z.string().regex(/^[0-9]{2}$/)
const date = z.string().regex(/^[0-3][0-9]-[01][0-9]-[0-9]{4}$/)
const docNumber = z.string().min(1).max(16)

const itemDetail = z.object({
  txval: rupees,
  rt: rate,
  iamt: rupees.optional(),
  camt: rupees.optional(),
  samt: rupees.optional(),
  csamt: rupees,
})
const items = z
  .array(z.object({ num: z.int().positive(), itm_det: itemDetail }))
  .min(1)

export const gstr1PayloadSchema = z.object({
  gstin,
  /** Filing period, MMYYYY. */
  fp: z.string().regex(/^(0[1-9]|1[0-2])[0-9]{4}$/),
  b2b: z.array(
    z.object({
      ctin: gstin,
      inv: z.array(
        z.object({
          inum: docNumber,
          idt: date,
          val: rupees,
          pos,
          rchrg: z.enum(["Y", "N"]),
          inv_typ: z.enum(["R", "SEWP", "SEWOP", "DE"]),
          itms: items,
        })
      ),
    })
  ),
  b2cl: z.array(
    z.object({
      pos,
      inv: z.array(
        z.object({ inum: docNumber, idt: date, val: rupees, itms: items })
      ),
    })
  ),
  b2cs: z.array(
    z.object({
      sply_ty: z.enum(["INTRA", "INTER"]),
      pos,
      typ: z.literal("OE"),
      txval: rupees,
      rt: rate,
      iamt: rupees.optional(),
      camt: rupees.optional(),
      samt: rupees.optional(),
      csamt: rupees,
    })
  ),
  exp: z.array(
    z.object({
      exp_typ: z.enum(["WPAY", "WOPAY"]),
      inv: z.array(
        z.object({
          inum: docNumber,
          idt: date,
          val: rupees,
          sbpcode: z.string().optional(),
          sbnum: z.string().optional(),
          sbdt: date.optional(),
          itms: z
            .array(
              z.object({
                txval: rupees,
                rt: rate,
                iamt: rupees,
                csamt: rupees,
              })
            )
            .min(1),
        })
      ),
    })
  ),
  cdnr: z.array(
    z.object({
      ctin: gstin,
      nt: z.array(
        z.object({
          ntty: z.enum(["C", "D"]),
          nt_num: docNumber,
          nt_dt: date,
          val: rupees,
          pos,
          rchrg: z.enum(["Y", "N"]),
          inv_typ: z.enum(["R", "SEWP", "SEWOP", "DE"]),
          itms: items,
        })
      ),
    })
  ),
  cdnur: z.array(
    z.object({
      typ: z.enum(["B2CL", "EXPWP", "EXPWOP"]),
      ntty: z.enum(["C", "D"]),
      nt_num: docNumber,
      nt_dt: date,
      val: rupees,
      pos: pos.optional(),
      itms: items,
    })
  ),
  hsn: z.object({
    data: z.array(
      z.object({
        num: z.int().positive(),
        hsn_sc: z.string().regex(/^[0-9]{4,8}$/),
        desc: z.string().max(30).optional(),
        uqc: z.string().min(2).max(3),
        qty: z.number().min(0),
        rt: rate,
        txval: rupees,
        iamt: rupees,
        camt: rupees,
        samt: rupees,
        csamt: rupees,
      })
    ),
  }),
  doc_issue: z.object({
    doc_det: z.array(
      z.object({
        /** 1: invoices for outward supply, 5: credit notes. */
        doc_num: z.int().positive(),
        docs: z.array(
          z.object({
            num: z.int().positive(),
            from: docNumber,
            to: docNumber,
            totnum: z.int().min(0),
            cancel: z.int().min(0),
            net_issue: z.int().min(0),
          })
        ),
      })
    ),
  }),
})
export type Gstr1Payload = z.infer<typeof gstr1PayloadSchema>

/**
 * A GSTR-1 draft for the CA to load into the GSTN offline tool, check and
 * file. Not filed by Median.
 */
export interface Gstr1Export {
  readonly period: Period
  readonly gstin: string
  readonly payload: Gstr1Payload
  /** Things the CA must check or add (missing HSN, shipping bills, …). */
  readonly warnings: readonly string[]
}
