import { paise } from "@workspace/ledger"
import { ServiceError } from "@workspace/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ASK_TOOL_LABELS } from "@/lib/ask-tools"

const services = vi.hoisted(() => ({
  getDashboardSummary: vi.fn(),
  getProfitAndLoss: vi.fn(),
  getBalanceSheet: vi.fn(),
  getTrialBalance: vi.fn(),
  listEntries: vi.fn(),
  listInvoices: vi.fn(),
  getInvoice: vi.fn(),
  getReceivablesAgeing: vi.fn(),
  getGstSummary: vi.fn(),
  getRevenueBreakdown: vi.fn(),
  getCashPosition: vi.fn(),
  listInboxItems: vi.fn(),
  listParties: vi.fn(),
}))
vi.mock("@/server/services", () => services)

const { createAskTools } = await import("./tools")

const ctx = { orgId: "org_1", userId: "u1", role: "finance" } as const
const tools = createAskTools(ctx)
type ExecuteOptions = Parameters<
  NonNullable<typeof tools.getCashPosition.execute>
>[1]
const options: ExecuteOptions = {
  toolCallId: "call_1",
  messages: [],
  context: {},
}

beforeEach(() => {
  for (const fn of Object.values(services)) fn.mockReset()
})

describe("Ask Median tools", () => {
  it("are the read-only services from the spec plus the two propose tools, each labelled", () => {
    expect(Object.keys(tools).sort()).toEqual(
      [...Object.keys(services), "proposeInvoice", "proposeJournal"].sort()
    )
    expect(Object.keys(ASK_TOOL_LABELS).sort()).toEqual(
      Object.keys(tools).sort()
    )
    for (const name of Object.keys(tools)) {
      // Reads, or proposals that only reach the inbox; nothing posts.
      expect(name).toMatch(/^(get|list|propose)[A-Z]/)
    }
  })

  it("runs with the caller's context and returns money as formatted rupees", async () => {
    services.getProfitAndLoss.mockResolvedValue({
      netProfit: paise(21_000_000n),
      income: [
        { accountId: "a1", name: "Sales", amount: paise(12_345_678_90n) },
      ],
    })
    const result = await tools.getProfitAndLoss.execute?.(
      { from: "2026-10-01", to: "2026-10-31" },
      options
    )
    expect(services.getProfitAndLoss).toHaveBeenCalledWith(
      ctx,
      "2026-10-01",
      "2026-10-31"
    )
    expect(result).toEqual({
      ok: true,
      data: {
        netProfit: "₹2,10,000.00",
        income: [{ accountId: "a1", name: "Sales", amount: "₹1,23,45,678.90" }],
      },
      sources: [
        {
          title: "Profit and loss, 1 Oct 2026 to 31 Oct 2026",
          href: "/reports?from=2026-10-01&to=2026-10-31",
        },
      ],
    })
  })

  it("tells the model when the role can't see something, instead of throwing", async () => {
    services.getTrialBalance.mockRejectedValue(
      new ServiceError("FORBIDDEN", "Your role (viewer) can't read report.")
    )
    const result = await tools.getTrialBalance.execute?.(
      { asOf: "2026-10-31" },
      options
    )
    expect(result).toEqual({
      ok: false,
      error: "FORBIDDEN",
      message: "Your role (viewer) can't read report.",
    })
  })

  it("lets unexpected errors through", async () => {
    services.getCashPosition.mockRejectedValue(new Error("db down"))
    await expect(
      tools.getCashPosition.execute?.({ asOf: "2026-10-31" }, options)
    ).rejects.toThrow("db down")
  })

  it("pages lists with a small limit and cites each record", async () => {
    services.listInvoices.mockResolvedValue({
      items: [
        { id: "inv-1", number: "INV/2026-27/0001", total: paise(118_000_00n) },
      ],
      nextCursor: "c2",
    })
    const result = await tools.listInvoices.execute?.(
      { status: "issued", cursor: null },
      options
    )
    expect(services.listInvoices).toHaveBeenCalledWith(
      ctx,
      null,
      { status: "issued" },
      { limit: 25 }
    )
    expect(result).toMatchObject({
      ok: true,
      data: { nextCursor: "c2", items: [{ total: "₹1,18,000.00" }] },
      sources: [
        { href: "/invoices" },
        { title: "Invoice INV/2026-27/0001", href: "/invoices/inv-1" },
      ],
    })
  })

  it("says when an invoice isn't found, with no source", async () => {
    services.getInvoice.mockResolvedValue(null)
    const result = await tools.getInvoice.execute?.(
      { id: "0f8c6a52-4a9e-4d9b-9a53-1f1c2a3b4c5d" },
      options
    )
    expect(result).toEqual({ ok: true, data: { found: false }, sources: [] })
  })

  it("cites the filtered journal for entries", async () => {
    services.listEntries.mockResolvedValue({ items: [], nextCursor: null })
    const result = await tools.listEntries.execute?.(
      { from: "2026-10-01", to: "2026-10-31", search: "AWS", cursor: null },
      options
    )
    expect(result).toMatchObject({
      sources: [{ href: "/ledger?from=2026-10-01&to=2026-10-31&q=AWS" }],
    })
  })
})
