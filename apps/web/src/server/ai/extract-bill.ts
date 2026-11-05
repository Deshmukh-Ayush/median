import "server-only"

import { ServiceError } from "@workspace/contracts"
import { generateText, NoObjectGeneratedError, Output } from "ai"

import { todayIso } from "@/lib/format-date"

import {
  type AiBillExtraction,
  aiBillExtractionSchema,
  BILL_EXTRACTION_PROMPT,
} from "./bill-extraction"
import { type ReviewFlag, reviewBill } from "./bill-review"
import { fastModel } from "./models"

export const BILL_MEDIA_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const
export type BillMediaType = (typeof BILL_MEDIA_TYPES)[number]

export interface BillDocument {
  data: Uint8Array
  mediaType: BillMediaType
  filename?: string
}

export interface BillExtractionResult {
  /** Values as printed. Also a valid `BillExtraction` for the inbox. */
  extraction: AiBillExtraction
  /** Uncertain or failed a deterministic check. Only these reach the inbox. */
  needsReview: ReviewFlag[]
  /** Not printed on the bill. Informational; not sent to the inbox. */
  notPrinted: ReviewFlag[]
}

/**
 * Extracts a vendor bill (PDF or image) with `fastModel`. The AI only reads
 * the document: no totals, no tax. The result goes to the approval queue via
 * `createInboxItemFromExtraction`, never straight into the ledger.
 *
 * Gemini free tier: synthetic test bills only, never real customer bills.
 */
export async function extractBill(
  document: BillDocument
): Promise<BillExtractionResult> {
  let raw: unknown
  try {
    const result = await generateText({
      model: fastModel,
      temperature: 0,
      system: BILL_EXTRACTION_PROMPT,
      output: Output.object({ schema: aiBillExtractionSchema }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              data: document.data,
              mediaType: document.mediaType,
              ...(document.filename ? { filename: document.filename } : {}),
            },
            { type: "text", text: "Extract this bill." },
          ],
        },
      ],
    })
    raw = result.output
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new ServiceError(
        "VALIDATION",
        "We couldn't read this bill. Try a clearer scan or a PDF.",
        { cause: error.message }
      )
    }
    throw error
  }

  // AI output is external data: parse it again before use.
  const parsed = aiBillExtractionSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ServiceError(
      "VALIDATION",
      "We couldn't read this bill. Try a clearer scan or a PDF.",
      { issues: parsed.error.issues }
    )
  }
  return { extraction: parsed.data, ...reviewBill(parsed.data, todayIso()) }
}
