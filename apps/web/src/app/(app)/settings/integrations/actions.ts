"use server"

import { refresh } from "next/cache"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import {
  CURRENT_CONSENT_VERSION,
  idSchema,
  isServiceError,
  razorpayKeyCredentialsSchema,
} from "@workspace/contracts"

import { safeRedirect } from "@/lib/safe-redirect"
import {
  connect,
  disconnect,
  importFile,
  recordConsent,
  startRazorpayOAuth,
  syncConnection,
} from "@/server/services"

import { getOrgContextOrRedirect } from "../../org-context"
import { MAX_IMPORT_BYTES, isTestMode } from "./mode"

const INTEGRATIONS = "/settings/integrations"

/** Where a CONSENT_REQUIRED error sends the user: the consent screen. */
function consentUrl(next: string = INTEGRATIONS): string {
  return `${INTEGRATIONS}/consent?next=${encodeURIComponent(next)}`
}

function isConsentRequired(error: unknown): boolean {
  return isServiceError(error) && error.code === "CONSENT_REQUIRED"
}

export interface IntegrationFormState {
  error?: string
  success?: string
}

/** Sends the browser to Razorpay's approval screen (read-only scope). */
export async function connectRazorpay(): Promise<void> {
  const ctx = await getOrgContextOrRedirect()
  let authorizeUrl: string
  try {
    const result = await startRazorpayOAuth(ctx, { returnTo: INTEGRATIONS })
    authorizeUrl = result.authorizeUrl
  } catch (error) {
    if (isConsentRequired(error)) redirect(consentUrl())
    if (isServiceError(error)) {
      redirect(`${INTEGRATIONS}?status=failed`)
    }
    throw error
  }
  redirect(authorizeUrl)
}

/** Razorpay API keys: test mode only. Live accounts use OAuth. */
export async function connectRazorpayTestKeys(
  _previous: IntegrationFormState,
  formData: FormData
): Promise<IntegrationFormState> {
  if (!isTestMode()) {
    return { error: "API keys work only in test mode. Use Connect Razorpay." }
  }
  const parsed = razorpayKeyCredentialsSchema.safeParse({
    keyId: formData.get("keyId"),
    keySecret: formData.get("keySecret"),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the keys." }
  }
  const ctx = await getOrgContextOrRedirect()
  try {
    await connect(ctx, "razorpay-test-keys", parsed.data)
  } catch (error) {
    if (isConsentRequired(error)) redirect(consentUrl())
    if (isServiceError(error)) return { error: error.message }
    throw error
  }
  refresh()
  return { success: "Razorpay test account connected." }
}

const importSchema = z.object({
  provider: z.enum(["razorpay-settlement-report", "bank-statement"]),
  connectionId: z.union([idSchema, z.literal("")]).optional(),
})

/**
 * Imports a settlement report or bank statement through the file-connector
 * flow. CSV only here: PDF statements go through AI extraction first.
 */
export async function importConnectorFile(
  _previous: IntegrationFormState,
  formData: FormData
): Promise<IntegrationFormState> {
  const parsed = importSchema.safeParse({
    provider: formData.get("provider"),
    connectionId: formData.get("connectionId") ?? undefined,
  })
  const file = formData.get("file")
  if (!parsed.success) return { error: "Unknown connector." }
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file." }
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { error: "That file is over 4 MB. Split it by month and retry." }
  }
  const isCsv = file.type === "text/csv" || file.name.toLowerCase().endsWith(".csv")
  if (!isCsv) return { error: "Upload the CSV export." }

  const ctx = await getOrgContextOrRedirect()
  const connectionId = parsed.data.connectionId || undefined
  let result
  try {
    result = await importFile(
      ctx,
      parsed.data.provider,
      {
        kind: "text",
        fileName: file.name,
        mimeType: "text/csv",
        text: await file.text(),
      },
      connectionId ? { connectionId } : {}
    )
  } catch (error) {
    if (isConsentRequired(error)) redirect(consentUrl())
    if (isServiceError(error)) return { error: error.message }
    throw error
  }
  refresh()
  const parts = [
    `${result.imported} imported`,
    result.duplicates > 0 ? `${result.duplicates} already there` : null,
    `${result.posted} posted`,
    result.sentToInbox > 0 ? `${result.sentToInbox} sent to the inbox` : null,
    result.errors.length > 0 ? `${result.errors.length} rows unreadable` : null,
  ].filter(Boolean)
  return { success: `${parts.join(", ")}.` }
}

export async function syncNow(connectionId: string): Promise<void> {
  const id = idSchema.parse(connectionId)
  const ctx = await getOrgContextOrRedirect()
  try {
    await syncConnection(ctx, id)
  } catch (error) {
    if (isConsentRequired(error)) redirect(consentUrl())
    if (isServiceError(error)) redirect(`${INTEGRATIONS}?status=sync_failed`)
    throw error
  }
  refresh()
}

export async function disconnectConnection(connectionId: string): Promise<void> {
  const id = idSchema.parse(connectionId)
  const ctx = await getOrgContextOrRedirect()
  try {
    await disconnect(ctx, id)
  } catch (error) {
    if (isServiceError(error)) redirect(`${INTEGRATIONS}?status=failed`)
    throw error
  }
  refresh()
}

/** Records consent for the current version, then returns to `next`. */
export async function acceptConsent(next: string): Promise<void> {
  const ctx = await getOrgContextOrRedirect()
  const requestHeaders = await headers()
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
  const userAgent = requestHeaders.get("user-agent")
  await recordConsent(ctx, CURRENT_CONSENT_VERSION, {
    ...(ip ? { ipAddress: ip } : {}),
    ...(userAgent ? { userAgent: userAgent.slice(0, 500) } : {}),
  })
  redirect(safeRedirect(next, INTEGRATIONS))
}
