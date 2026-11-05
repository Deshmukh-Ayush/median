import { describe, expect, it } from "vitest"

import {
  gstinSchema,
  moneyJsonSchema,
  pageOptionsSchema,
  parseInput,
  periodSchema,
} from "./common"
import { ServiceError } from "./errors"

describe("common schemas", () => {
  it("reads integer-paise strings as bigint Money", () => {
    expect(moneyJsonSchema.parse("11800000")).toBe(11_800_000n)
    expect(moneyJsonSchema.safeParse("118000.50").success).toBe(false)
  })

  it("normalises and validates GSTINs", () => {
    expect(gstinSchema.parse(" 29aabca1234f1z5 ")).toBe("29AABCA1234F1Z5")
    expect(gstinSchema.safeParse("29AABCA1234F1Y5").success).toBe(false)
  })

  it("validates periods and page sizes", () => {
    expect(periodSchema.safeParse("2026-13").success).toBe(false)
    expect(pageOptionsSchema.parse({})).toEqual({ limit: 50 })
    expect(pageOptionsSchema.safeParse({ limit: 201 }).success).toBe(false)
  })
})

describe("parseInput", () => {
  it("turns Zod failures into ServiceError VALIDATION", () => {
    try {
      parseInput(periodSchema, "nope")
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError)
      expect((error as ServiceError).code).toBe("VALIDATION")
    }
  })
})
