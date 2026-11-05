"use server"

import { refresh } from "next/cache"
import { z } from "zod"

import { idSchema, isServiceError } from "@workspace/contracts"

import { approveInboxItem, rejectInboxItem } from "@/server/services"

import { getOrgContextOrRedirect } from "../org-context"

export type InboxActionResult =
  { ok: true; ids: string[] } | { ok: false; error: string; ids: string[] }

/** Bulk approval is capped so one click can't post an unbounded batch. */
const MAX_BULK = 50

const idsSchema = z.array(idSchema).min(1).max(MAX_BULK)
const reasonSchema = z
  .string()
  .trim()
  .min(1, "Say why you're rejecting this.")
  .max(500)

function failure(error: unknown, ids: string[]): InboxActionResult {
  if (isServiceError(error)) return { ok: false, error: error.message, ids }
  throw error
}

/**
 * Approves items one by one; stops at the first failure and reports which
 * ones went through. STUB services: there's no bulk-approve contract yet.
 */
export async function approveItems(ids: unknown): Promise<InboxActionResult> {
  const parsed = idsSchema.safeParse(ids)
  if (!parsed.success) {
    return { ok: false, error: "Pick between 1 and 50 items.", ids: [] }
  }
  const ctx = await getOrgContextOrRedirect()
  const approved: string[] = []
  for (const id of parsed.data) {
    try {
      await approveInboxItem(ctx, id)
      approved.push(id)
    } catch (error) {
      refresh()
      return failure(error, approved)
    }
  }
  refresh()
  return { ok: true, ids: approved }
}

export async function rejectItem(
  id: unknown,
  reason: unknown
): Promise<InboxActionResult> {
  const itemId = idSchema.safeParse(id)
  const note = reasonSchema.safeParse(reason)
  if (!itemId.success) return { ok: false, error: "Unknown item.", ids: [] }
  if (!note.success) {
    return {
      ok: false,
      error: note.error.issues[0]?.message ?? "Add a reason.",
      ids: [],
    }
  }
  const ctx = await getOrgContextOrRedirect()
  try {
    await rejectInboxItem(ctx, itemId.data, note.data)
  } catch (error) {
    return failure(error, [])
  }
  refresh()
  return { ok: true, ids: [itemId.data] }
}
