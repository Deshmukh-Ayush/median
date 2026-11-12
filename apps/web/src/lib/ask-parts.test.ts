import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"

import { askSources, askSteps, askText } from "./ask-parts"

const answer: UIMessage = {
  id: "a1",
  role: "assistant",
  parts: [
    {
      type: "tool-getProfitAndLoss",
      toolCallId: "t1",
      state: "output-available",
      input: { from: "2026-10-01", to: "2026-10-31" },
      output: {
        ok: true,
        data: {},
        sources: [
          {
            title: "Profit and loss",
            href: "/reports?from=2026-10-01&to=2026-10-31",
          },
        ],
      },
    },
    {
      type: "tool-getTrialBalance",
      toolCallId: "t2",
      state: "output-available",
      input: { asOf: "2026-10-31" },
      output: { ok: false, error: "FORBIDDEN", message: "No." },
    },
    {
      type: "tool-listParties",
      toolCallId: "t3",
      state: "input-available",
      input: {},
    },
    {
      type: "tool-listInvoices",
      toolCallId: "t4",
      state: "output-available",
      input: {},
      output: {
        ok: true,
        data: {},
        sources: [
          {
            title: "Profit and loss",
            href: "/reports?from=2026-10-01&to=2026-10-31",
          },
          { title: "Bad", href: "https://evil.example" },
          { title: "Invoice 1", href: "/invoices/1" },
        ],
      },
    },
    { type: "text", text: "Net profit was ₹2,10,000.00." },
  ],
}

describe("Ask message parts", () => {
  it("labels each tool step with its status", () => {
    expect(askSteps(answer)).toEqual([
      { id: "t1", label: "Read profit and loss", status: "done" },
      { id: "t2", label: "Read the trial balance", status: "error" },
      { id: "t3", label: "Reading customers and vendors…", status: "running" },
      { id: "t4", label: "Read invoices", status: "done" },
    ])
  })

  it("lists in-app sources once, in order", () => {
    expect(askSources(answer).map((s) => s.href)).toEqual([
      "/reports?from=2026-10-01&to=2026-10-31",
      "/invoices/1",
    ])
  })

  it("joins the answer text", () => {
    expect(askText(answer)).toBe("Net profit was ₹2,10,000.00.")
  })
})
