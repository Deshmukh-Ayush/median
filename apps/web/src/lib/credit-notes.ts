import type { CreditNoteReason } from "@workspace/contracts"

export const CREDIT_NOTE_REASON_LABELS: Record<CreditNoteReason, string> = {
  refund: "Refund",
  sales_return: "Goods returned",
  post_sale_discount: "Discount after sale",
  deficiency_in_service: "Service not as agreed",
  correction: "Correction to the invoice",
}

/** How one invoice line is credited: a quantity returned, or a taxable value. */
export type CreditMode = "quantity" | "taxable"

/** One line of the credit-note form, as text. Blank lines are skipped. */
export interface CreditLineDraft {
  readonly invoiceLineId: string
  readonly mode: CreditMode
  readonly value: string
}
