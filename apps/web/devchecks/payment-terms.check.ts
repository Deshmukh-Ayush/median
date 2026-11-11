import { expect, it } from "vitest"

import { listAuditLog } from "../src/server/services/audit"
import {
  getDefaultPaymentTerms,
  setDefaultPaymentTerms,
} from "../src/server/services/payment-terms"
import { freshDevOrg } from "./setup"

it("default payment terms: 30 days until set, audited, 0–365", async () => {
  const ctx = await freshDevOrg("terms")
  expect(await getDefaultPaymentTerms(ctx)).toBe(30)
  expect(await setDefaultPaymentTerms(ctx, 45)).toBe(45)
  expect(await getDefaultPaymentTerms(ctx)).toBe(45)
  await expect(setDefaultPaymentTerms(ctx, 400)).rejects.toMatchObject({
    code: "VALIDATION",
  })
  const audit = await listAuditLog(ctx, null, {}, { limit: 1 })
  expect(audit.items[0]).toMatchObject({ action: "settings.payment_terms" })
})
