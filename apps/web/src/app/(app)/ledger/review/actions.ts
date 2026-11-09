"use server"

import { revalidatePath } from "next/cache"

import { isServiceError, periodSchema } from "@workspace/contracts"

import { lockPeriod } from "@/server/services"

import { getOrgContextOrRedirect } from "../../org-context"

export type LockPeriodResult =
  | { readonly ok: true; readonly period: string; readonly lockedAt: string }
  | { readonly ok: false; readonly error: string }

/** Locks a month. Nothing can be posted into it afterwards. */
export async function lockPeriodAction(
  period: unknown
): Promise<LockPeriodResult> {
  const parsed = periodSchema.safeParse(period)
  if (!parsed.success) return { ok: false, error: "Choose a month to lock." }
  const ctx = await getOrgContextOrRedirect()
  try {
    const lock = await lockPeriod(ctx, parsed.data)
    revalidatePath("/ledger/review")
    revalidatePath("/gst")
    return { ok: true, period: lock.period, lockedAt: lock.lockedAt }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    throw error
  }
}
