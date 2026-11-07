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
const { bulkApproveInboxItems } = await import("./inbox")

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
  // Approving against the database is covered by devchecks (dev branch).
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
