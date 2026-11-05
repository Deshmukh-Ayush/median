/**
 * Regenerates the 30 synthetic bills and their ground truth:
 *   npm run eval:bills:generate
 * Output: evals/bills/data/bill-NN.{pdf,png,jpg} + bill-NN.json. Deterministic
 * (seeded), so regenerating gives identical ground truth.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, it } from "vitest"

import { aiBillExtractionSchema } from "@/server/ai/bill-extraction"
import { reviewBill } from "@/server/ai/bill-review"

import { buildBills, expectedFor, type GroundTruth, notesFor } from "./fixtures"
import { renderImage } from "./render-image"
import { renderPdf } from "./render-pdf"
import { scoreBill } from "./score"

const DATA_DIR = fileURLToPath(new URL("./data", import.meta.url))

it("generates 30 synthetic bills with ground truth", async () => {
  rmSync(DATA_DIR, { recursive: true, force: true })
  mkdirSync(DATA_DIR, { recursive: true })

  const bills = buildBills()
  expect(bills).toHaveLength(30)

  for (const [i, bill] of bills.entries()) {
    const expected = expectedFor(bill)
    // Ground truth must be a valid AI output and score 100% against itself.
    const asExtraction = aiBillExtractionSchema.parse({
      ...expected,
      lowConfidenceFields: [],
    })
    // A correctly read bill must pass every review check.
    expect(reviewBill(asExtraction, "2026-11-06").needsReview).toEqual([])
    expect(scoreBill(expected, expected, []).every((s) => s.correct)).toBe(true)

    let file: string
    let mediaType: GroundTruth["mediaType"]
    if (bill.quality === "pdf") {
      file = `${bill.id}.pdf`
      mediaType = "application/pdf"
      writeFileSync(join(DATA_DIR, file), await renderPdf(bill))
    } else {
      const image = await renderImage(bill, i)
      mediaType = image.mediaType
      file = `${bill.id}.${mediaType === "image/png" ? "png" : "jpg"}`
      writeFileSync(join(DATA_DIR, file), image.data)
    }

    const truth: GroundTruth = {
      id: bill.id,
      file,
      mediaType,
      layout: bill.layout,
      quality: bill.quality,
      supply: bill.supply,
      notes: notesFor(bill),
      expected,
    }
    writeFileSync(
      join(DATA_DIR, `${bill.id}.json`),
      `${JSON.stringify(truth, null, 2)}\n`
    )
  }
})
