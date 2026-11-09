"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { isServiceError } from "@workspace/contracts"
import type { ImportResult } from "@workspace/contracts"

import { importFile } from "@/server/services"

import { getOrgContextOrRedirect } from "../../org-context"
import { MAX_IMPORT_BYTES } from "../integrations/mode"

const TALLY_PROVIDER = "tally-import"

export type TallyImportState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly error: string }
  | {
      readonly status: "done"
      readonly fileName: string
      readonly result: ImportResult
    }

/**
 * Imports a Tally XML export (masters, vouchers or both): importFile
 * creates accounts and parties, posts opening balances and vouchers, and
 * checks the trial balance. Re-importing the same file adds nothing twice.
 */
export async function importTallyFile(
  _previous: TallyImportState,
  formData: FormData
): Promise<TallyImportState> {
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return {
      status: "error",
      error: "Choose the XML file you exported from Tally.",
    }
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return {
      status: "error",
      error:
        "That file is over 4 MB. Export masters and vouchers separately, or vouchers one year at a time.",
    }
  }
  const isXml =
    file.type === "application/xml" ||
    file.type === "text/xml" ||
    file.name.toLowerCase().endsWith(".xml")
  if (!isXml) {
    return { status: "error", error: "Upload the XML export from Tally." }
  }

  const ctx = await getOrgContextOrRedirect()
  let result: ImportResult
  try {
    result = await importFile(ctx, TALLY_PROVIDER, {
      kind: "text",
      fileName: file.name,
      mimeType: "application/xml",
      text: await file.text(),
    })
  } catch (error) {
    if (isServiceError(error) && error.code === "CONSENT_REQUIRED") {
      redirect(
        `/settings/integrations/consent?next=${encodeURIComponent("/settings/import")}`
      )
    }
    if (isServiceError(error)) return { status: "error", error: error.message }
    throw error
  }
  revalidatePath("/", "layout")
  return { status: "done", fileName: file.name, result }
}
