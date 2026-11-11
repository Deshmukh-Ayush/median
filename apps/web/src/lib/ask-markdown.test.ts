import { describe, expect, it } from "vitest"

import { isAppHref, parseAskMarkdown, parseInline } from "./ask-markdown"

describe("parseInline", () => {
  it("keeps a cited figure and its in-app link", () => {
    expect(
      parseInline(
        "Net profit was **₹2,10,000.00** ([P&L](/reports?from=2026-10-01&to=2026-10-31))."
      )
    ).toEqual([
      { type: "text", text: "Net profit was " },
      { type: "strong", children: [{ type: "text", text: "₹2,10,000.00" }] },
      { type: "text", text: " (" },
      {
        type: "link",
        href: "/reports?from=2026-10-01&to=2026-10-31",
        children: [{ type: "text", text: "P&L" }],
      },
      { type: "text", text: ")." },
    ])
  })

  it("never links outside the app", () => {
    for (const href of [
      "https://evil.example",
      "//evil.example",
      "javascript:alert(1)",
      "/\\evil.example",
    ]) {
      const nodes = parseInline(`[click](${href})`)
      expect(nodes.some((n) => n.type === "link")).toBe(false)
      expect(nodes[0]).toEqual({ type: "text", text: "click" })
      expect(isAppHref(href)).toBe(false)
    }
    expect(isAppHref("/invoices/abc")).toBe(true)
  })
})

describe("parseAskMarkdown", () => {
  it("splits paragraphs and lists", () => {
    const blocks = parseAskMarkdown(
      "Top customers:\n- Acme: ₹1,00,000.00\n- Zenith: ₹50,000.00\n\n1. First\n2. Second\nDone."
    )
    expect(blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "list",
      "list",
      "paragraph",
    ])
    expect(blocks[1]).toMatchObject({ ordered: false, items: [[{}], [{}]] })
    expect(blocks[2]).toMatchObject({ ordered: true })
  })

  it("turns headings into bold lines and joins wrapped lines", () => {
    expect(parseAskMarkdown("## Cash\nYou have\nmoney.")).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "strong", children: [{ type: "text", text: "Cash" }] },
        ],
      },
      {
        type: "paragraph",
        children: [{ type: "text", text: "You have money." }],
      },
    ])
  })
})
