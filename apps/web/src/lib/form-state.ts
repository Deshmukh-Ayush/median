import { z } from "zod"

/** What a server action returns to its form via useActionState. */
export interface FormState {
  /** A message for the whole form, shown above the submit button. */
  readonly error?: string
  /** One message per field name. */
  readonly fieldErrors?: Readonly<Record<string, string>>
  /** Submitted values to refill the form after an error (never passwords). */
  readonly values?: Readonly<Record<string, string>>
}

export const EMPTY_FORM_STATE: FormState = {}

/** The first message per field from a Zod error. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const flat = z.flattenError(error).fieldErrors as Record<
    string,
    string[] | undefined
  >
  const out: Record<string, string> = {}
  for (const [key, messages] of Object.entries(flat)) {
    const first = messages?.[0]
    if (first) out[key] = first
  }
  return out
}

/** Reads string fields from FormData; files and missing fields become "". */
export function formValues<K extends string>(
  formData: FormData,
  keys: readonly K[]
): Record<K, string> {
  const out = {} as Record<K, string>
  for (const key of keys) {
    const value = formData.get(key)
    out[key] = typeof value === "string" ? value : ""
  }
  return out
}
