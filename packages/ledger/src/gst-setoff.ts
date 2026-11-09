import type { Money } from "./money"
import { paise } from "./money"

/** Tax per head, in paise. */
export interface TaxHeads {
  readonly igst: Money
  readonly cgst: Money
  readonly sgst: Money
}

export interface SetOffResult {
  /** Liability left after using credit: paid in cash. Never negative. */
  readonly cashPayable: TaxHeads
  /** Credit left after the set-off, carried to the next period. */
  readonly creditCarriedForward: TaxHeads
}

const min = (a: bigint, b: bigint) => (a < b ? a : b)
const pos = (a: bigint) => (a > 0n ? a : 0n)

/**
 * Uses input tax credit against output tax in the order section 49 of the
 * CGST Act and rule 88A require:
 *   1. IGST credit against IGST, then against CGST and SGST.
 *   2. CGST credit against CGST, then IGST.
 *   3. SGST credit against SGST, then IGST.
 * CGST credit never pays SGST and vice versa. Step 1's split between CGST
 * and SGST is free, so it first covers what each head's own credit can't,
 * which leaves the least cash to pay. Negative inputs (net reversals in the
 * period) count as zero liability or zero credit.
 */
export function setOffGst(output: TaxHeads, credit: TaxHeads): SetOffResult {
  let lI = pos(output.igst)
  let lC = pos(output.cgst)
  let lS = pos(output.sgst)
  let cI = pos(credit.igst)
  let cC = pos(credit.cgst)
  let cS = pos(credit.sgst)

  // 1. IGST credit.
  let use = min(cI, lI)
  lI -= use
  cI -= use
  // What CGST and SGST credit alone can't cover gets IGST credit first.
  const shortC = pos(lC - cC)
  const shortS = pos(lS - cS)
  use = min(cI, shortC)
  lC -= use
  cI -= use
  use = min(cI, shortS)
  lS -= use
  cI -= use
  use = min(cI, lC)
  lC -= use
  cI -= use
  use = min(cI, lS)
  lS -= use
  cI -= use

  // 2. CGST credit: CGST, then IGST.
  use = min(cC, lC)
  lC -= use
  cC -= use
  use = min(cC, lI)
  lI -= use
  cC -= use

  // 3. SGST credit: SGST, then IGST.
  use = min(cS, lS)
  lS -= use
  cS -= use
  use = min(cS, lI)
  lI -= use
  cS -= use

  return {
    cashPayable: { igst: paise(lI), cgst: paise(lC), sgst: paise(lS) },
    creditCarriedForward: { igst: paise(cI), cgst: paise(cC), sgst: paise(cS) },
  }
}
