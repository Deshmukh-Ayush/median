"use server"

import type { InboxActionResult } from "@/app/(app)/inbox/actions"

// Preview-only actions for /design: nothing is posted or stored.

export async function previewApprove(
  ids: string[]
): Promise<InboxActionResult> {
  await Promise.resolve()
  return { ok: true, ids }
}

export async function previewReject(
  id: string,
  reason: string
): Promise<InboxActionResult> {
  await Promise.resolve()
  return reason.trim()
    ? { ok: true, ids: [id] }
    : { ok: false, error: "Say why you're rejecting this.", ids: [] }
}
