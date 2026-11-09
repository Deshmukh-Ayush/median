import { describe, expect, it } from "vitest"

import { setOffGst } from "./gst-setoff"
import { paise } from "./money"

const h = (igst: bigint, cgst: bigint, sgst: bigint) => ({
  igst: paise(igst),
  cgst: paise(cgst),
  sgst: paise(sgst),
})

describe("setOffGst (section 49, rule 88A)", () => {
  it("uses each head's credit against its own head", () => {
    expect(setOffGst(h(100n, 50n, 50n), h(30n, 20n, 20n))).toEqual({
      cashPayable: h(70n, 30n, 30n),
      creditCarriedForward: h(0n, 0n, 0n),
    })
  })

  it("uses IGST credit against CGST and SGST after IGST", () => {
    expect(setOffGst(h(0n, 50n, 50n), h(80n, 0n, 0n))).toEqual({
      cashPayable: h(0n, 0n, 20n),
      creditCarriedForward: h(0n, 0n, 0n),
    })
  })

  it("splits IGST credit to leave the least cash", () => {
    // CGST credit covers CGST, so IGST credit goes to SGST.
    expect(setOffGst(h(0n, 50n, 50n), h(50n, 50n, 0n))).toEqual({
      cashPayable: h(0n, 0n, 0n),
      creditCarriedForward: h(0n, 0n, 0n),
    })
  })

  it("uses CGST and SGST credit against IGST, never each other", () => {
    expect(setOffGst(h(100n, 0n, 40n), h(0n, 60n, 0n))).toEqual({
      cashPayable: h(40n, 0n, 40n),
      creditCarriedForward: h(0n, 0n, 0n),
    })
    expect(setOffGst(h(0n, 0n, 40n), h(0n, 60n, 0n))).toEqual({
      cashPayable: h(0n, 0n, 40n),
      creditCarriedForward: h(0n, 60n, 0n),
    })
  })

  it("carries unused credit forward and treats negatives as zero", () => {
    expect(setOffGst(h(-5n, 10n, 10n), h(100n, -3n, 0n))).toEqual({
      cashPayable: h(0n, 0n, 0n),
      creditCarriedForward: h(80n, 0n, 0n),
    })
  })
})
