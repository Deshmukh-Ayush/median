import { describe, expect, it } from "vitest"

import { askPageContextSchema } from "./ask-context"
import { pageContextFromRoute } from "./ask-page-context"

const INVOICE = "0f8c6a52-4a9e-4d9b-9a53-1f1c2a3b4c5d"
const ITEM = "1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d"
const q = (s = "") => new URLSearchParams(s)

describe("pageContextFromRoute", () => {
  it("takes record ids from the path", () => {
    expect(pageContextFromRoute(`/invoices/${INVOICE}`, q())).toEqual({
      page: `/invoices/${INVOICE}`,
      ids: [INVOICE],
    })
    expect(pageContextFromRoute(`/parties/${INVOICE}`, q()).ids).toEqual([
      INVOICE,
    ])
  })

  it("reads the GST month, a report range or an as-of date", () => {
    expect(pageContextFromRoute("/gst", q("period=2026-10")).period).toEqual({
      month: "2026-10",
    })
    expect(
      pageContextFromRoute("/reports", q("from=2026-04-01&to=2026-10-31"))
        .period
    ).toEqual({ from: "2026-04-01", to: "2026-10-31" })
    expect(
      pageContextFromRoute("/reports", q("view=balance-sheet&asOf=2026-10-31"))
        .period
    ).toEqual({ asOf: "2026-10-31" })
  })

  it("adds ids the page registered, like the inbox item in focus", () => {
    expect(pageContextFromRoute("/inbox", q(), [ITEM])).toEqual({
      page: "/inbox",
      ids: [ITEM],
    })
  })

  it("drops anything that isn't a valid id, date or month", () => {
    const ctx = pageContextFromRoute(
      "/gst",
      q("period=2026-13&from=x&to=2026-01-01"),
      ["not-an-id", "<script>"]
    )
    expect(ctx).toEqual({ page: "/gst", ids: [] })
    expect(
      pageContextFromRoute("/reports", q("from=2026-10-31&to=2026-10-01"))
        .period
    ).toBeUndefined()
  })

  it("always produces something the server accepts", () => {
    for (const [path, query] of [
      [`/invoices/${INVOICE}`, ""],
      ["/gst", "period=2026-10"],
      ["/weird path?", "asOf=2026-10-31"],
    ] as const) {
      expect(
        askPageContextSchema.safeParse(pageContextFromRoute(path, q(query)))
          .success
      ).toBe(true)
    }
  })
})
