import { paise, resolveGstRate } from "@workspace/ledger"
import type { ResolvedGstRate } from "@workspace/ledger"
import { describe, expect, it } from "vitest"

import {
  bankLineRule,
  feeRule,
  findBankMatch,
  istDateOf,
  paymentMappingKey,
  paymentRule,
  receiptRule,
  refundRule,
  settlementRule,
} from "./posting-rules"
import type {
  Decision,
  OriginalPayment,
  RuleAccounts,
  RuleOrg,
  RuleRecord,
} from "./posting-rules"

const accounts: RuleAccounts = {
  clearing: "clearing",
  bank: "bank",
  revenue: "revenue",
  outputCgst: "out_cgst",
  outputSgst: "out_sgst",
  outputIgst: "out_igst",
  inputCgst: "in_cgst",
  inputSgst: "in_sgst",
  inputIgst: "in_igst",
  gatewayCharges: "gateway",
  receivables: "receivables",
  tdsReceivable: "tds",
  suspense: "suspense",
  payables: "payables",
}
const karnataka: RuleOrg = {
  gstRegistered: true,
  compositionScheme: false,
  stateCode: "29",
}
const maharashtra: RuleOrg = { ...karnataka, stateCode: "27" }

const record = (r: Partial<RuleRecord>): RuleRecord => ({
  id: "rec_1",
  kind: "payment",
  externalId: "pay_1",
  // 10:00 IST on 22 Sep 2025.
  occurredAt: new Date("2025-09-22T04:30:00Z"),
  amountPaise: 118_000n,
  settlementExternalId: null,
  payload: { captured: true, status: "captured", notes: {} },
  ...r,
})
const found = (rateBps: number): ResolvedGstRate => ({
  status: "found",
  rateBps,
  source: "org_default",
})

/** Debits equal credits, and the summary for assertions. */
function lines(d: Decision) {
  if (d.action !== "post" && d.action !== "inbox" && d.action !== "credit_note")
    throw new Error(`expected an entry, got ${d.action}`)
  const debit = d.entry.lines.reduce((s, l) => s + l.debit, 0n)
  const credit = d.entry.lines.reduce((s, l) => s + l.credit, 0n)
  expect(debit).toBe(credit)
  return Object.fromEntries(
    d.entry.lines.map((l) => [
      `${l.debit > 0n ? "Dr" : "Cr"} ${l.accountId}`,
      l.debit > 0n ? l.debit : l.credit,
    ])
  )
}

describe("dates", () => {
  it("books on the IST calendar date", () => {
    expect(istDateOf(new Date("2025-09-21T19:00:00Z"))).toBe("2025-09-22")
    expect(istDateOf(new Date("2025-09-21T18:29:59Z"))).toBe("2025-09-21")
  })
})

describe("payments (rule 8)", () => {
  const ctx = { accounts, org: karnataka, invoice: null }

  it("splits a GST-inclusive payment at the rate valid that day", () => {
    const d = paymentRule(record({}), { ...ctx, rate: found(1800) })
    expect(d.action).toBe("post")
    expect(lines(d)).toEqual({
      "Dr clearing": 118_000n,
      "Cr revenue": 100_000n,
      "Cr out_cgst": 9_000n,
      "Cr out_sgst": 9_000n,
    })
    if (d.action === "post")
      expect(d.dimensions).toEqual({ 1: { gst_rate_bps: "1800" } })
  })

  it("uses the mapping rate before and after 22 Sep 2025", () => {
    const mappingRates = [
      { rateBps: 1200, effectiveFrom: null, effectiveTo: "2025-09-21" },
      { rateBps: 500, effectiveFrom: "2025-09-22", effectiveTo: null },
    ]
    const at = (iso: string) => {
      const r = record({ occurredAt: new Date(iso), amountPaise: 11_200n })
      return paymentRule(r, {
        ...ctx,
        rate: resolveGstRate({
          supplyDate: istDateOf(r.occurredAt),
          gstRegistered: true,
          mappingRates,
        }),
      })
    }
    expect(lines(at("2025-09-21T10:00:00Z"))).toMatchObject({
      "Cr revenue": 10_000n,
      "Cr out_cgst": 600n,
    })
    expect(lines(at("2025-09-22T10:00:00Z"))).toMatchObject({
      "Cr revenue": 10_667n,
      "Cr out_cgst": 267n,
      "Cr out_sgst": 266n,
    })
  })

  it("books all revenue when not GST-registered or on composition", () => {
    for (const org of [
      { ...karnataka, gstRegistered: false },
      { ...karnataka, compositionScheme: true },
    ]) {
      const d = paymentRule(record({}), { ...ctx, org, rate: found(1800) })
      expect(lines(d)).toEqual({
        "Dr clearing": 118_000n,
        "Cr revenue": 118_000n,
      })
    }
  })

  it("sends payments with no rate, or no org state, to the inbox", () => {
    const noRate = paymentRule(record({}), {
      ...ctx,
      rate: { status: "inbox", reason: "no_rate", source: null },
    })
    expect(noRate).toMatchObject({ action: "inbox", kind: "razorpay_record" })
    lines(noRate)
    const noState = paymentRule(record({}), {
      ...ctx,
      org: { ...karnataka, stateCode: null },
      rate: found(1800),
    })
    expect(noState.action).toBe("inbox")
  })

  it("waits for capture and ignores failures", () => {
    const authorized = record({
      payload: { captured: false, status: "authorized" },
    })
    expect(paymentRule(authorized, { ...ctx, rate: found(1800) }).action).toBe(
      "wait"
    )
    const failed = record({ payload: { captured: false, status: "failed" } })
    expect(paymentRule(failed, { ...ctx, rate: found(1800) }).action).toBe(
      "ignore"
    )
  })

  it("reads the mapping key from notes: product first, then stream", () => {
    expect(paymentMappingKey({ notes: { product: "plan_pro" } })).toEqual({
      kind: "product",
      key: "plan_pro",
    })
    expect(paymentMappingKey({ notes: { stream: "subscriptions" } })).toEqual({
      kind: "stream",
      key: "subscriptions",
    })
    expect(paymentMappingKey({ notes: [] })).toBeNull()
  })
})

describe("gateway fees (rule 9)", () => {
  const fee = record({
    kind: "fee",
    externalId: "pay_1:fee",
    amountPaise: 2_360n,
    payload: { payment_id: "pay_1", fee: 2_360, tax: 360 },
  })

  it("uses the connection's fee GST state, defaulting to Karnataka", () => {
    // A Maharashtra org whose Razorpay bills from Maharashtra: CGST+SGST.
    expect(
      lines(feeRule(fee, { accounts, org: maharashtra, feeGstStateCode: "27" }))
    ).toMatchObject({ "Dr in_cgst": 180n, "Dr in_sgst": 180n })
    expect(
      lines(feeRule(fee, { accounts, org: karnataka, feeGstStateCode: "27" }))
    ).toMatchObject({ "Dr in_igst": 360n })
    expect(
      lines(feeRule(fee, { accounts, org: karnataka, feeGstStateCode: null }))
    ).toMatchObject({ "Dr in_cgst": 180n })
  })

  it("books Razorpay's fee and tax as returned, never computing 18%", () => {
    expect(lines(feeRule(fee, { accounts, org: karnataka }))).toEqual({
      "Dr gateway": 2_000n,
      "Dr in_cgst": 180n,
      "Dr in_sgst": 180n,
      "Cr clearing": 2_360n,
    })
    expect(lines(feeRule(fee, { accounts, org: maharashtra }))).toEqual({
      "Dr gateway": 2_000n,
      "Dr in_igst": 360n,
      "Cr clearing": 2_360n,
    })
    // An odd tax figure is used as is.
    const odd = record({
      ...fee,
      kind: "fee",
      amountPaise: 2_361n,
      payload: { fee: 2_361, tax: 361 },
    })
    expect(lines(feeRule(odd, { accounts, org: maharashtra }))).toMatchObject({
      "Dr in_igst": 361n,
    })
  })

  it("claims no input credit when unregistered", () => {
    expect(
      lines(
        feeRule(fee, {
          accounts,
          org: { ...karnataka, gstRegistered: false },
        })
      )
    ).toEqual({ "Dr gateway": 2_360n, "Cr clearing": 2_360n })
  })

  it("flags fee fields that don't add up", () => {
    const bad = record({ ...fee, payload: { fee: 100, tax: 360 } })
    expect(feeRule(bad, { accounts, org: karnataka }).action).toBe("inbox")
  })
})

describe("refunds (rule 10)", () => {
  const paymentLines = [
    {
      accountId: "clearing",
      partyId: null,
      debit: 118_000n,
      credit: 0n,
      dimensions: null,
    },
    {
      accountId: "revenue",
      partyId: null,
      debit: 0n,
      credit: 100_000n,
      dimensions: { gst_rate_bps: "1800" },
    },
    {
      accountId: "out_cgst",
      partyId: null,
      debit: 0n,
      credit: 9_000n,
      dimensions: null,
    },
    {
      accountId: "out_sgst",
      partyId: null,
      debit: 0n,
      credit: 9_000n,
      dimensions: null,
    },
  ]
  const original: OriginalPayment = {
    externalId: "pay_1",
    amountPaise: 118_000n,
    status: "posted",
    entryId: "entry_1",
    lines: paymentLines,
    invoiceNumber: null,
  }
  const refund = (amountPaise: bigint, status = "processed") =>
    record({
      kind: "refund",
      externalId: "rfnd_1",
      amountPaise,
      payload: { payment_id: "pay_1", status },
    })

  it("reverses the payment entry on a full refund", () => {
    const d = refundRule(refund(118_000n), {
      accounts,
      original,
      refundedBefore: 0n,
    })
    expect(d).toMatchObject({ action: "post", reversesEntryId: "entry_1" })
    expect(lines(d)).toEqual({
      "Cr clearing": 118_000n,
      "Dr revenue": 100_000n,
      "Dr out_cgst": 9_000n,
      "Dr out_sgst": 9_000n,
    })
  })

  it("reverses a share at the payment's rate on a partial refund", () => {
    const d = refundRule(refund(59_000n), {
      accounts,
      original,
      refundedBefore: 0n,
    })
    expect(d.action).toBe("post")
    if (d.action === "post") expect(d.reversesEntryId).toBeUndefined()
    expect(lines(d)).toEqual({
      "Dr revenue": 50_000n,
      "Dr out_cgst": 4_500n,
      "Dr out_sgst": 4_500n,
      "Cr clearing": 59_000n,
    })
  })

  it("credits the invoice when the payment settled one (rule 10)", () => {
    const receipt: OriginalPayment = {
      ...original,
      invoiceNumber: "INV/2026-27/0042",
      lines: [
        {
          accountId: "clearing",
          partyId: null,
          debit: 118_000n,
          credit: 0n,
          dimensions: null,
        },
        {
          accountId: "receivables",
          partyId: "acme",
          debit: 0n,
          credit: 118_000n,
          dimensions: null,
        },
      ],
    }
    const d = refundRule(refund(59_000n), {
      accounts,
      original: receipt,
      refundedBefore: 0n,
    })
    expect(d).toMatchObject({
      action: "credit_note",
      invoiceNumber: "INV/2026-27/0042",
      reference: "rfnd_1",
    })
    // The payout goes back through the customer's receivable.
    expect(lines(d)).toEqual({
      "Dr receivables": 59_000n,
      "Cr clearing": 59_000n,
    })
    expect(
      refundRule(refund(59_000n), {
        accounts,
        original: receipt,
        refundedBefore: 60_000n,
      }).action
    ).toBe("inbox")
  })

  it("treats a quoted invoice number as a plain sale when the payment didn't settle it", () => {
    // Booked as a GST-inclusive sale (no receivable): reverse it like any sale.
    const d = refundRule(refund(118_000n), {
      accounts,
      original: { ...original, invoiceNumber: "INV/2026-27/0042" },
      refundedBefore: 0n,
    })
    expect(d).toMatchObject({ action: "post", reversesEntryId: "entry_1" })
  })

  it("sends unknown, unbooked or over-refunds to the inbox", () => {
    const run = (o: OriginalPayment | null, before = 0n) =>
      refundRule(refund(59_000n), {
        accounts,
        original: o,
        refundedBefore: before,
      }).action
    expect(run(null)).toBe("inbox")
    expect(run({ ...original, status: "inbox", entryId: null })).toBe("inbox")
    expect(run({ ...original, status: "new", entryId: null })).toBe("wait")
    expect(run(original, 60_000n)).toBe("inbox")
  })

  it("waits for pending refunds and ignores failed ones", () => {
    const ctx = { accounts, original, refundedBefore: 0n }
    expect(refundRule(refund(100n, "pending"), ctx).action).toBe("wait")
    expect(refundRule(refund(100n, "failed"), ctx).action).toBe("ignore")
  })
})

describe("settlements, through Razorpay clearing", () => {
  const settlement = (recon: "available" | "unavailable") =>
    record({
      kind: "settlement",
      externalId: "setl_1",
      amountPaise: 115_640n,
      payload: { status: "processed", recon },
    })
  const linked = {
    payments: 118_000n,
    fees: 2_360n,
    refunds: 0n,
    count: 2,
  }

  it("posts to the bank when payments − fees − refunds equal the settlement", () => {
    const d = settlementRule(settlement("available"), { accounts, linked })
    expect(d.action).toBe("post")
    expect(lines(d)).toEqual({ "Dr bank": 115_640n, "Cr clearing": 115_640n })
  })

  it("flags a gap in Indian format, and settlements without recon", () => {
    const gap = settlementRule(settlement("available"), {
      accounts,
      linked: { ...linked, fees: 2_000n },
    })
    expect(gap).toMatchObject({ action: "inbox", kind: "settlement_gap" })
    if (gap.action === "inbox") expect(gap.reason).toContain("₹3.60 less")
    expect(
      settlementRule(settlement("unavailable"), { accounts, linked }).action
    ).toBe("inbox")
  })
})

describe("receipts against invoices (rule 11)", () => {
  const invoice = {
    id: "inv_1",
    number: "INV/0042",
    partyId: "acme",
    total: paise(1_18_000_00n),
    taxable: paise(1_00_000_00n),
    outstanding: paise(1_18_000_00n),
  }
  const ctx = {
    accounts,
    debitAccountId: "bank",
    entryDate: "2026-11-01",
    reference: "UTR1",
    kind: "bank_line" as const,
  }

  it("posts exact receipts and names the invoice they pay", () => {
    expect(receiptRule(invoice.total, invoice, ctx)).toMatchObject({
      action: "post",
      invoiceId: "inv_1",
    })
  })

  it("matches what's outstanding, not the original total", () => {
    const partPaid = { ...invoice, outstanding: paise(18_000_00n) }
    expect(receiptRule(paise(18_000_00n), partPaid, ctx)).toMatchObject({
      action: "post",
      invoiceId: "inv_1",
    })
    // The full total no longer fits, and TDS isn't tried on a part-paid invoice.
    expect(receiptRule(paise(1_16_000_00n), partPaid, ctx)).toMatchObject({
      action: "inbox",
      tds: null,
      invoiceId: "inv_1",
    })
  })

  it("proposes TDS receivable at 1%, 2% or 10% for review", () => {
    for (const [rateBps, tds] of [
      [100, 1_000_00n],
      [200, 2_000_00n],
      [1000, 10_000_00n],
    ] as const) {
      const d = receiptRule(paise(invoice.total - tds), invoice, ctx)
      expect(d).toMatchObject({
        action: "inbox",
        tds: { rateBps, amount: tds },
      })
      expect(lines(d)).toMatchObject({
        "Dr tds": tds,
        "Cr receivables": invoice.total,
      })
    }
  })

  it("sends other shortfalls to the inbox without TDS", () => {
    const d = receiptRule(paise(1_10_000_00n), invoice, ctx)
    expect(d).toMatchObject({ action: "inbox", tds: null })
  })
})

describe("bank lines", () => {
  const line = (direction: "inflow" | "outflow", amountPaise: bigint) => ({
    ...record({ kind: "bank_line", externalId: null, amountPaise }),
    direction,
    reference: null,
    payload: { description: "NEFT CR RAZORPAY UTR1" },
  })
  const base = {
    accounts,
    suspense: "suspense",
    payables: "payables",
    bankAccountId: "hdfc",
  }
  const settlement = {
    externalId: "setl_1",
    status: "posted" as const,
    entryId: "e_setl",
    bankAccountId: null as string | null,
    amountPaise: 115_640n,
    date: "2025-09-21",
    utr: "UTR1",
  }
  const invoice = {
    id: "inv_1",
    number: "INV/2026-27/0042",
    partyId: "acme",
    total: paise(1_18_000_00n),
    taxable: paise(1_00_000_00n),
    outstanding: paise(1_18_000_00n),
    date: "2025-09-01",
  }
  const candidates = {
    settlements: [settlement],
    invoices: [invoice],
    vendors: [],
  }
  const find = (
    direction: "inflow" | "outflow",
    amountPaise: bigint,
    text: string,
    c: Partial<Parameters<typeof findBankMatch>[1]> = {}
  ) =>
    findBankMatch(
      { direction, amountPaise, date: "2025-09-22", text },
      { ...candidates, ...c }
    )

  it("matches a settlement credit by amount and date, UTR breaking ties", () => {
    expect(find("inflow", 115_640n, "NEFT")).toMatchObject({
      kind: "settlement",
    })
    const two = [
      settlement,
      { ...settlement, externalId: "setl_2", utr: "UTR2" },
    ]
    expect(find("inflow", 115_640n, "NEFT", { settlements: two }).kind).toBe(
      "ambiguous"
    )
    expect(
      find("inflow", 115_640n, "NEFT UTR2", { settlements: two })
    ).toMatchObject({ settlement: { externalId: "setl_2" } })
    // Outside the window: no match.
    expect(
      find("inflow", 115_640n, "NEFT", {
        settlements: [{ ...settlement, date: "2025-09-01" }],
        invoices: [],
      }).kind
    ).toBe("none")
  })

  it("links to the settlement entry, or moves it from the default bank", () => {
    const match = { kind: "settlement" as const, settlement }
    expect(
      bankLineRule(line("inflow", 115_640n), {
        ...base,
        bankAccountId: "bank",
        match,
      })
    ).toEqual({ action: "link", entryId: "e_setl" })
    expect(
      lines(
        bankLineRule(line("inflow", 115_640n), { ...base, match }) as Decision
      )
    ).toEqual({ "Dr hdfc": 115_640n, "Cr bank": 115_640n })
    // Settled into ICICI (the connection's settlement bank): link there,
    // transfer from it elsewhere.
    const icici = {
      kind: "settlement" as const,
      settlement: { ...settlement, bankAccountId: "icici" },
    }
    expect(
      bankLineRule(line("inflow", 115_640n), {
        ...base,
        bankAccountId: "icici",
        match: icici,
      })
    ).toEqual({ action: "link", entryId: "e_setl" })
    expect(
      lines(
        bankLineRule(line("inflow", 115_640n), {
          ...base,
          match: icici,
        }) as Decision
      )
    ).toEqual({ "Dr hdfc": 115_640n, "Cr icici": 115_640n })
  })

  it("matches by outstanding amount once an invoice is part-paid", () => {
    const partPaid = { ...invoice, outstanding: paise(18_000_00n) }
    expect(
      find("inflow", 18_000_00n, "NEFT ACME", { invoices: [partPaid] })
    ).toMatchObject({ kind: "invoice" })
    expect(
      find("inflow", 1_18_000_00n, "NEFT ACME", { invoices: [partPaid] })
    ).toMatchObject({ kind: "none" })
  })

  it("matches invoice receipts by number, amount or TDS (rule 11)", () => {
    expect(find("inflow", 5_00n, "IMPS INV/2026-27/0042")).toMatchObject({
      kind: "invoice",
    })
    expect(find("inflow", 1_16_000_00n, "NEFT ACME")).toMatchObject({
      kind: "invoice",
    })
    const d = bankLineRule(line("inflow", 1_16_000_00n), {
      ...base,
      match: { kind: "invoice", invoice },
    })
    expect(d).toMatchObject({
      action: "inbox",
      kind: "bank_line",
      tds: { rateBps: 200 },
    })
  })

  it("proposes known vendor payments and parks the rest in suspense", () => {
    const vendors = [{ partyId: "aws", name: "AWS India" }]
    const match = find("outflow", 11_800_00n, "UPI-AWS INDIA-PAYMENT", {
      vendors,
    })
    expect(match).toMatchObject({ kind: "vendor" })
    expect(
      lines(
        bankLineRule(line("outflow", 11_800_00n), {
          ...base,
          match,
        }) as Decision
      )
    ).toEqual({ "Dr payables": 11_800_00n, "Cr hdfc": 11_800_00n })
    const none = bankLineRule(line("outflow", 999n), {
      ...base,
      match: { kind: "none" },
    })
    expect(none).toMatchObject({ action: "inbox", confidence: 0.3 })
    expect(lines(none as Decision)).toEqual({
      "Dr suspense": 999n,
      "Cr hdfc": 999n,
    })
  })
})
