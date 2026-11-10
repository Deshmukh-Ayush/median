// Data-processing consent. Connecting, syncing, importing and AI extraction
// refuse to run (CONSENT_REQUIRED) until the current version is accepted.

import { z } from "zod"

import type { IsoTimestamp } from "./common"

/**
 * Version of the consent text the app shows. Bump it here (a contracts PR)
 * when the text changes; the organisation must accept the new version.
 */
export const CURRENT_CONSENT_VERSION = "2026-11-10"

export const consentVersionSchema = z.string().trim().min(1).max(50)

export interface ConsentStatus {
  readonly currentVersion: string
  /** True once someone in the organisation accepted `currentVersion`. */
  readonly accepted: boolean
  readonly acceptedAt: IsoTimestamp | null
  readonly acceptedBy: { readonly id: string; readonly name: string } | null
}
