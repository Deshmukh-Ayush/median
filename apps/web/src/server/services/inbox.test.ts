import { BULK_APPROVE_MAX, ServiceError } from "@workspace/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { OrgContext } from "./context"

const consent = vi.hoisted(() => ({ accepted: true }))
vi.mock("./consent", async () => {
  const { ServiceError: Err } = await import("@workspace/contracts")
  return {
    requireConsent: vi.fn(() => {
      if (!consent.accepted)
        throw new Err("CONSENT_REQUIRED", "Accept consent first.")
      return Promise.resolve()
    }),
  }
})

const { createInboxItemFromExtraction } = await import("./extraction")
const { bulkApproveInboxItems, listInboxItems } = await import("./inbox")

beforeEach(() => {
  consent.accepted = true
})

const ctx: OrgContext = { orgId: "org_1", userId: "user_1", role: "finance" }

const bill = {
  vendor: {
    name: "Amazon Web Services",
    gstin: "29AAICA3918J1ZE",
    stateCode: "29",
  },
  billNumber: "IN-2026-1",
  billDate: "2026-11-01",
  dueDate: null,
  placeOfSupplyStateCode: "29",
  currency: "INR",
  lines: [
    {
      description: "EC2",
      hsnSac: "998315",
      quantity: "1",
      taxableAmount: "1,000.00",
      gstRatePercent: "18",
    },
    {
      description: "Support",
      hsnSac: null,
      quantity: null,
      taxableAmount: "0.25",
      gstRatePercent: "18%",
    },
  ],
  printedTotals: {
    taxable: null,
    cgst: null,
    sgst: null,
    igst: null,
    total: null,
  },
  // Extra keys the AI module adds are ignored, not an error.
  lowConfidenceFields: [{ field: "billDate", reason: "blurred" }],
}

describe("createInboxItemFromExtraction", () => {
  it("carries review flags to the inbox item", async () => {
    const item = await createInboxItemFromExtraction(
      ctx,
      "00000000-0000-4000-8000-00000000d009",
      bill,
      {
        needsReview: [
          {
            field: "billDate",
            kind: "needs_review",
            reason: "blurred",
            source: "model",
          },
        ],
        notPrinted: [
          {
            field: "dueDate",
            kind: "not_printed",
            reason: "no due date",
            source: "check",
          },
        ],
      }
    )
    expect(item.reviewFlags.needsReview).toHaveLength(1)
    expect(item.reviewFlags.notPrinted[0]?.field).toBe("dueDate")
    expect(item.confidence).toBeLessThan(0.7)
  })

  it("computes tax in code, odd paisa on CGST, and names each line", async () => {
    const item = await createInboxItemFromExtraction(
      ctx,
      "00000000-0000-4000-8000-00000000d009",
      bill
    )
    // 1000.25 taxable; 18% of 1000.00 = 180.00, of 0.25 = 0.05 (half up).
    expect(item.gst).toMatchObject({
      taxable: 1_000_25n,
      cgst: 90_03n,
      sgst: 90_02n,
      igst: 0n,
    })
    expect(item.reviewFlags).toEqual({ needsReview: [], notPrinted: [] })
    expect(
      item.proposedEntry.lines.every((l) => l.accountName.length > 0)
    ).toBe(true)
    const debits = item.proposedEntry.lines.reduce((s, l) => s + l.debit, 0n)
    const credits = item.proposedEntry.lines.reduce((s, l) => s + l.credit, 0n)
    expect(debits).toBe(credits)
  })

  it("needs recorded consent", async () => {
    consent.accepted = false
    await expect(
      createInboxItemFromExtraction(
        ctx,
        "00000000-0000-4000-8000-00000000d009",
        bill
      )
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" })
  })

  it("rejects malformed review flags", async () => {
    await expect(
      createInboxItemFromExtraction(
        ctx,
        "00000000-0000-4000-8000-00000000d009",
        bill,
        {
          needsReview: [
            { field: "", kind: "needs_review", reason: "x", source: "model" },
          ],
        }
      )
    ).rejects.toThrow(ServiceError)
  })
})

describe("bulkApproveInboxItems", () => {
  it("approves what it can and reports the rest", async () => {
    const { items } = await listInboxItems(ctx, null)
    const known = items.map((i) => i.id)
    const unknown = "00000000-0000-4000-8000-0000000fffff"
    const result = await bulkApproveInboxItems(ctx, [...known, unknown])
    expect(result.approved.map((a) => a.id)).toEqual(known)
    expect(result.failed).toEqual([
      { id: unknown, code: "NOT_FOUND", message: "Inbox item not found." },
    ])
  })

  it(`refuses more than ${BULK_APPROVE_MAX} ids, duplicates, and read-only roles`, async () => {
    const ids = Array.from(
      { length: BULK_APPROVE_MAX + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
    )
    await expect(bulkApproveInboxItems(ctx, ids)).rejects.toThrow(ServiceError)
    const id = "00000000-0000-4000-8000-00000000c001"
    await expect(bulkApproveInboxItems(ctx, [id, id])).rejects.toThrow(
      ServiceError
    )
    await expect(
      bulkApproveInboxItems({ ...ctx, role: "investor" }, [id])
    ).rejects.toThrow("can't post ledger")
  })
})
