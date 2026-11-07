import { describe, expect, it } from "vitest"

import { detectDocumentType } from "./document-type"

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((p) =>
      typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p
    )
  )
const hint = { fileName: "bill.pdf", claimedType: "application/pdf" }

describe("detectDocumentType", () => {
  it("recognises PDF, PNG, JPEG and WebP by their bytes", () => {
    expect(detectDocumentType(bytes("%PDF-1.7\n"), hint)).toBe(
      "application/pdf"
    )
    expect(
      detectDocumentType(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]), hint)
    ).toBe("image/png")
    expect(detectDocumentType(bytes([0xff, 0xd8, 0xff, 0xe0]), hint)).toBe(
      "image/jpeg"
    )
    expect(
      detectDocumentType(bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 "), hint)
    ).toBe("image/webp")
  })

  it("ignores what the browser claims", () => {
    expect(
      detectDocumentType(bytes("<html><script>"), {
        fileName: "bill.pdf",
        claimedType: "application/pdf",
      })
    ).toBeNull()
    expect(
      detectDocumentType(bytes("%PDF-1.4"), {
        fileName: "x.csv",
        claimedType: "text/csv",
      })
    ).toBe("application/pdf")
  })

  it("accepts CSV only as control-free text named or typed as CSV", () => {
    const csv = bytes("Date,Narration,Amount\r\n01/11/2026,NEFT ₹,100.00\n")
    expect(
      detectDocumentType(csv, { fileName: "hdfc.CSV", claimedType: "" })
    ).toBe("text/csv")
    expect(
      detectDocumentType(csv, { fileName: "s.txt", claimedType: "text/csv" })
    ).toBe("text/csv")
    expect(
      detectDocumentType(csv, { fileName: "s.txt", claimedType: "text/plain" })
    ).toBeNull()
    expect(
      detectDocumentType(bytes("a,b", [0x00], "c"), {
        fileName: "x.csv",
        claimedType: "text/csv",
      })
    ).toBeNull()
    expect(
      detectDocumentType(new Uint8Array(), {
        fileName: "x.csv",
        claimedType: "",
      })
    ).toBeNull()
  })
})
