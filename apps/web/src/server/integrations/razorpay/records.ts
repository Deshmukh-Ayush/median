import type { SourceRecordInput } from "@workspace/contracts"

import type {
  RazorpayPayment,
  RazorpayReconItem,
  RazorpayRefund,
  RazorpaySettlement,
} from "./schemas"

// Razorpay API objects → SourceRecords. Pure, so the settlement-report file
// connector and tests produce exactly the same records.
//
// Payload contract read by the posting rules (services/posting-rules.ts):
// - payment: captured, status, notes, invoice_id, order_id, method
// - fee: payment_id, fee (incl. tax), tax — rule 9, as Razorpay returns them
// - refund: payment_id, status
// - settlement: status, fees, tax, utr, recon ("available" | "unavailable")

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString()

/** The fee record's external id for a payment. */
export const feeExternalId = (paymentId: string) => `${paymentId}:fee`

/** A payment, plus its gateway-fee record once Razorpay has charged one. */
export function paymentRecords(
  provider: string,
  p: RazorpayPayment
): SourceRecordInput[] {
  const records: SourceRecordInput[] = [
    {
      provider,
      kind: "payment",
      externalId: p.id,
      dedupeHash: null,
      occurredAt: iso(p.created_at),
      amountPaise: BigInt(p.amount),
      direction: "inflow",
      currency: p.currency,
      reference: p.order_id,
      settlementExternalId: null,
      payload: { ...p },
    },
  ]
  if (p.captured && p.fee !== null && p.fee > 0) {
    records.push({
      provider,
      kind: "fee",
      externalId: feeExternalId(p.id),
      dedupeHash: null,
      occurredAt: iso(p.created_at),
      amountPaise: BigInt(p.fee),
      direction: "outflow",
      currency: p.currency,
      reference: p.id,
      settlementExternalId: null,
      payload: { payment_id: p.id, fee: p.fee, tax: p.tax ?? 0 },
    })
  }
  return records
}

export function refundRecord(
  provider: string,
  r: RazorpayRefund
): SourceRecordInput {
  return {
    provider,
    kind: "refund",
    externalId: r.id,
    dedupeHash: null,
    occurredAt: iso(r.created_at),
    amountPaise: BigInt(r.amount),
    direction: "outflow",
    currency: r.currency,
    reference: r.payment_id,
    settlementExternalId: null,
    payload: { ...r },
  }
}

export function settlementRecord(
  provider: string,
  s: RazorpaySettlement,
  recon: "available" | "unavailable"
): SourceRecordInput {
  return {
    provider,
    kind: "settlement",
    externalId: s.id,
    dedupeHash: null,
    occurredAt: iso(s.created_at),
    amountPaise: BigInt(s.amount),
    direction: "outflow",
    currency: "INR",
    reference: s.utr,
    settlementExternalId: s.id,
    payload: { ...s, recon },
  }
}

/**
 * Settlement links from recon rows: payments (and their fee records) and
 * refunds, tied to the settlement they were paid out in.
 */
export function reconLinks(
  items: readonly RazorpayReconItem[]
): { externalId: string; settlementExternalId: string }[] {
  return items.flatMap((item) => {
    if (!item.settlement_id) return []
    const link = {
      externalId: item.entity_id,
      settlementExternalId: item.settlement_id,
    }
    return item.type === "payment"
      ? [link, { ...link, externalId: feeExternalId(item.entity_id) }]
      : [link]
  })
}

/** IST calendar date of a Unix timestamp (recon is per IST day). */
export function istDate(unixSeconds: number): {
  year: number
  month: number
  day: number
} {
  const d = new Date((unixSeconds + 19_800) * 1000)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}
