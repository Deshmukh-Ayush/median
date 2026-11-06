// GST state and union-territory codes (the first two digits of a GSTIN and
// the "place of supply" code on invoices).

export interface GstState {
  /** Two-digit GST code, e.g. "29". */
  readonly code: string
  readonly name: string
  /**
   * Union territories without a legislature charge UTGST instead of SGST on
   * intrastate supplies (same amount, different label on invoices).
   */
  readonly intrastateTax: "SGST" | "UTGST"
  /** False for codes kept only to read old documents (pre-merger / pre-split). */
  readonly active: boolean
}

const s = (
  code: string,
  name: string,
  intrastateTax: GstState["intrastateTax"] = "SGST",
  active = true
): GstState => ({ code, name, intrastateTax, active })

export const GST_STATES: readonly GstState[] = [
  s("01", "Jammu and Kashmir"),
  s("02", "Himachal Pradesh"),
  s("03", "Punjab"),
  s("04", "Chandigarh", "UTGST"),
  s("05", "Uttarakhand"),
  s("06", "Haryana"),
  s("07", "Delhi"),
  s("08", "Rajasthan"),
  s("09", "Uttar Pradesh"),
  s("10", "Bihar"),
  s("11", "Sikkim"),
  s("12", "Arunachal Pradesh"),
  s("13", "Nagaland"),
  s("14", "Manipur"),
  s("15", "Mizoram"),
  s("16", "Tripura"),
  s("17", "Meghalaya"),
  s("18", "Assam"),
  s("19", "West Bengal"),
  s("20", "Jharkhand"),
  s("21", "Odisha"),
  s("22", "Chhattisgarh"),
  s("23", "Madhya Pradesh"),
  s("24", "Gujarat"),
  s("25", "Daman and Diu (merged into 26 in 2020)", "UTGST", false),
  s("26", "Dadra and Nagar Haveli and Daman and Diu", "UTGST"),
  s("27", "Maharashtra"),
  s("28", "Andhra Pradesh (before 2018)", "SGST", false),
  s("29", "Karnataka"),
  s("30", "Goa"),
  s("31", "Lakshadweep", "UTGST"),
  s("32", "Kerala"),
  s("33", "Tamil Nadu"),
  s("34", "Puducherry"),
  s("35", "Andaman and Nicobar Islands", "UTGST"),
  s("36", "Telangana"),
  s("37", "Andhra Pradesh"),
  s("38", "Ladakh", "UTGST"),
  s("97", "Other Territory", "UTGST"),
]

/** Place of supply for exports ("Other Countries"). */
export const GST_EXPORT_PLACE_OF_SUPPLY = "96"

const byCode = new Map(GST_STATES.map((state) => [state.code, state]))

/** The state for a GST code, or undefined. */
export function gstStateByCode(code: string): GstState | undefined {
  return byCode.get(code)
}

/** True for a code that's valid on a new document today. */
export function isActiveGstStateCode(code: string): boolean {
  return byCode.get(code)?.active === true
}
