import { and, eq } from "drizzle-orm"
import { afterEach, expect, it } from "vitest"

import { getDb } from "../src/server/db"
import {
  documents,
  ledgerAccounts,
  organizationSettings,
} from "../src/server/db/schema"
import { setDocumentStoreForTests } from "../src/server/integrations/document-store"
import { registerDocument } from "../src/server/services/documents"
import { createInboxItemFromExtraction } from "../src/server/services/extraction"
import { approveInboxItem } from "../src/server/services/inbox"
import { findPartyByGstin } from "../src/server/services/parties"
import { devOrg } from "./setup"

afterEach(() => setDocumentStoreForTests(null))

// Synthetic test data only. A fresh, checksum-valid GSTIN per run so the
// vendor is new each time.
function gstin(state: string): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)] ?? "A"
  const body = `${state}${Array.from({ length: 5 }, () => pick(letters)).join("")}${String(Math.floor(Math.random() * 9000) + 1000)}${pick(letters)}1Z`
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const v = chars.indexOf(body[i] ?? "0") * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(v / 36) + (v % 36)
  }
  return body + chars[(36 - (sum % 36)) % 36]
}

it("bills: document → inbox proposal → approval", async () => {
  const ctx = await devOrg()
  const db = getDb()
  await db
    .update(organizationSettings)
    .set({
      gstRegistered: true,
      gstin: "29ABCDE1234F1ZW",
      stateCode: "29",
      compositionScheme: false,
    })
    .where(eq(organizationSettings.organizationId, ctx.orgId))
  const files = new Map<string, Blob>()
  setDocumentStoreForTests({
    put: (p, b) => (files.set(p, b), Promise.resolve({ pathname: p })),
    get: (p) => {
      const f = files.get(p)
      return Promise.resolve(
        f ? { stream: f.stream(), contentType: f.type, size: f.size } : null
      )
    },
    delete: (p) => (files.delete(p), Promise.resolve()),
    deletePrefix: () => Promise.resolve(0),
  })
  const run = Date.now()
  const vendorGstin = gstin("27")
  const upload = () =>
    registerDocument(ctx, {
      kind: "bill",
      file: new File(
        [`%PDF-1.7\n% synthetic ${run} ${Math.random()}\n`],
        "bill.pdf"
      ),
    })
  const extraction = (billNumber: string) => ({
    vendor: {
      name: `Devcheck Cloud ${run}`,
      gstin: vendorGstin,
      stateCode: "27",
    },
    billNumber,
    billDate: "2026-11-01",
    dueDate: null,
    placeOfSupplyStateCode: "29",
    currency: "INR",
    lines: [
      {
        description: "Compute",
        hsnSac: "998315",
        quantity: "1",
        taxableAmount: "10,000.00",
        gstRatePercent: "18",
      },
    ],
    printedTotals: {
      taxable: "10,000.00",
      cgst: null,
      sgst: null,
      igst: "1,800.00",
      total: "11,800.00",
    },
  })

  // First bill: new vendor (added from the GSTIN), Suspense, IGST.
  const doc = await upload()
  const first = await createInboxItemFromExtraction(
    ctx,
    doc.id,
    extraction(`B-${run}`)
  )
  console.log("first", first.reason, first.confidence, first.reviewFlags)
  const vendor = await findPartyByGstin(ctx, vendorGstin, "vendor")
  expect(vendor).toMatchObject({ kind: "vendor", stateCode: "27" })
  expect(first).toMatchObject({
    kind: "bill",
    status: "pending",
    sourceDocumentUrl: `/api/documents/${doc.id}`,
    gst: {
      taxable: 10_000_00n,
      igst: 1_800_00n,
      cgst: 0n,
      supplyType: "interstate",
    },
  })
  expect(
    first.proposedEntry.lines.map((l) => [l.accountName, l.debit, l.credit])
  ).toEqual([
    ["Suspense", 10_000_00n, 0n],
    [expect.stringMatching(/IGST/i) as string, 1_800_00n, 0n],
    [expect.stringMatching(/payable/i) as string, 0n, 11_800_00n],
  ])
  expect(first.reviewFlags.needsReview.map((f) => f.field)).toEqual([
    "expenseAccount",
  ])
  const [docRow] = await db
    .select({ status: documents.status })
    .from(documents)
    .where(
      and(eq(documents.organizationId, ctx.orgId), eq(documents.id, doc.id))
    )
  expect(docRow?.status).toBe("extracted")
  await expect(
    createInboxItemFromExtraction(ctx, doc.id, extraction(`B-${run}`))
  ).rejects.toMatchObject({
    code: "CONFLICT",
  })

  // The reviewer books it to Cloud hosting.
  const [hosting] = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.organizationId, ctx.orgId),
        eq(ledgerAccounts.code, "5010")
      )
    )
  expect(hosting).toBeDefined()
  await approveInboxItem(ctx, first.id, {
    lines: first.proposedEntry.lines.map((l, i) => ({
      accountId: i === 0 ? (hosting?.id ?? "") : l.accountId,
      partyId: l.partyId,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
    })),
  })

  // Second bill from them: the account is learned, nothing to check.
  const second = await createInboxItemFromExtraction(
    ctx,
    (await upload()).id,
    extraction(`C-${run}`)
  )
  console.log("second", second.reason, second.confidence)
  expect(second.proposedEntry.lines[0]?.accountId).toBe(hosting?.id)
  expect(second.reviewFlags.needsReview).toEqual([])
  expect(second.confidence).toBe(0.8)

  // Same bill number again (a different scan) is flagged as a duplicate.
  const dup = await createInboxItemFromExtraction(
    ctx,
    (await upload()).id,
    extraction(`C-${run}`)
  )
  expect(dup.reviewFlags.needsReview.map((f) => f.field)).toContain(
    "billNumber"
  )

  // A bank statement isn't a bill.
  const csv = await registerDocument(ctx, {
    kind: "bank_statement",
    file: new File(["a,b\n1,2\n"], "s.csv"),
  })
  await expect(
    createInboxItemFromExtraction(ctx, csv.id, extraction("X"))
  ).rejects.toMatchObject({
    code: "VALIDATION",
  })
})
