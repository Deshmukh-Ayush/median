import type { InvoiceStatus, InvoiceSupplyType } from "@workspace/contracts"

export const INVOICE_STATUS: Record<
  InvoiceStatus,
  { label: string; tone: "neutral" | "success" | "warning" | "danger" }
> = {
  issued: { label: "Issued", tone: "neutral" },
  partially_paid: { label: "Partly paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
}

/** How each supply type is taxed, in founder language. */
export const SUPPLY_LABELS: Record<InvoiceSupplyType, string> = {
  intrastate: "Intra-state: CGST + SGST",
  interstate: "Inter-state: IGST",
  export_with_payment: "Export, IGST paid",
  export_lut: "Export under LUT: no IGST",
  sez: "Supply to SEZ: IGST",
}

/** Whether tax shows as CGST + SGST (else IGST). */
export const isIntrastate = (t: InvoiceSupplyType) => t === "intrastate"

/** The builder's "Special supply" choices (createInvoice's specialSupply). */
export const SPECIAL_SUPPLIES = [
  { value: "", label: "None (domestic)" },
  { value: "export_with_payment", label: "Export with payment of IGST" },
  { value: "export_lut", label: "Export under LUT (no IGST)" },
  { value: "sez", label: "Supply to an SEZ unit" },
] as const

export type SpecialSupply = Exclude<
  (typeof SPECIAL_SUPPLIES)[number]["value"],
  ""
>

export function specialSupplyOf(value: string): SpecialSupply | null {
  for (const s of SPECIAL_SUPPLIES) {
    if (s.value !== "" && s.value === value) return s.value
  }
  return null
}

/** Exports are placed in "96" (other country); everything else in a state. */
export const isExport = (s: SpecialSupply | null) =>
  s === "export_with_payment" || s === "export_lut"
