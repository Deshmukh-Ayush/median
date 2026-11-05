import "server-only"

import { parseInput, periodSchema } from "@workspace/contracts"
import type { Money, Period } from "@workspace/contracts"
import { paise } from "@workspace/ledger"

import type { OrgContext } from "./context"
import { assertCan } from "./context"

export interface GstTaxAmounts {
  readonly igst: Money
  readonly cgst: Money
  readonly sgst: Money
  readonly total: Money
}

export interface GstOutwardRow extends GstTaxAmounts {
  readonly rateBps: number
  readonly taxable: Money
}

/** GSTR-3B style summary for one month. */
export interface GstSummary {
  readonly period: Period
  /** 3.1(a): outward taxable supplies, split by rate. */
  readonly outward: readonly GstOutwardRow[]
  readonly outwardTotal: GstTaxAmounts & { readonly taxable: Money }
  /** 4(A)(5): all other eligible ITC. */
  readonly inputTaxCredit: GstTaxAmounts
  /** Output tax minus ITC, per head. Negative means credit carried forward. */
  readonly netPayable: GstTaxAmounts
  /** False while the period is still open (numbers can change). */
  readonly isLocked: boolean
}

const t = (igst: bigint, cgst: bigint, sgst: bigint): GstTaxAmounts => ({
  igst: paise(igst),
  cgst: paise(cgst),
  sgst: paise(sgst),
  total: paise(igst + cgst + sgst),
})

/** STUB. */
export async function getGstSummary(
  ctx: OrgContext,
  period: Period
): Promise<GstSummary> {
  assertCan(ctx, "report", "read")
  const p = parseInput(periodSchema, period)
  await Promise.resolve()
  return {
    period: p,
    outward: [
      {
        rateBps: 1800,
        taxable: paise(8_50_000_00n),
        ...t(45_000_00n, 54_000_00n, 54_000_00n),
      },
      {
        rateBps: 500,
        taxable: paise(80_000_00n),
        ...t(0n, 2_000_00n, 2_000_00n),
      },
    ],
    outwardTotal: {
      taxable: paise(9_30_000_00n),
      ...t(45_000_00n, 56_000_00n, 56_000_00n),
    },
    inputTaxCredit: t(18_406_20n, 11_340_00n, 11_340_00n),
    netPayable: t(26_593_80n, 44_660_00n, 44_660_00n),
    isLocked: false,
  }
}
