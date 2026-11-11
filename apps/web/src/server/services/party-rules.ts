// Rules for a party's GST details. Pure: the party service resolves input
// with these before writing, so the same checks hold for create and edit.

import {
  REGISTRATION_TYPES_WITH_GSTIN,
  ServiceError,
  panFromGstin,
} from "@workspace/contracts"
import type {
  MsmeCategory,
  PartyKind,
  PartyRegistrationType,
  TdsDefaultSection,
} from "@workspace/contracts"

/** A party's details as stored (every field present). */
export interface PartyFields {
  readonly name: string
  readonly legalName: string | null
  readonly gstin: string | null
  readonly pan: string | null
  readonly registrationType: PartyRegistrationType
  readonly stateCode: string | null
  readonly billingAddress: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly paymentTermsDays: number | null
  readonly defaultTdsSection: TdsDefaultSection | null
  readonly msmeCategory: MsmeCategory | null
  readonly udyamNumber: string | null
}

/** Input after Zod: optional fields may be missing, null clears them. */
export type PartyFieldsInput = {
  readonly [K in keyof PartyFields]?: PartyFields[K] | null | undefined
}

function invalid(field: string, message: string): ServiceError {
  return new ServiceError("VALIDATION", message, { field })
}

/**
 * Registration type when the input doesn't say: keep the old one if it still
 * fits the GSTIN (e.g. an SEZ unit's new GSTIN), else regular with a GSTIN
 * and unregistered (or still overseas) without.
 */
function defaultRegistrationType(
  gstin: string | null,
  previous: PartyRegistrationType | undefined
): PartyRegistrationType {
  if (gstin)
    return previous && REGISTRATION_TYPES_WITH_GSTIN.includes(previous)
      ? previous
      : "regular"
  return previous === "overseas" ? "overseas" : "unregistered"
}

/**
 * Fills in what the GSTIN implies (state, PAN, registration type) and checks
 * the combination. `base` is the stored party when editing.
 */
export function resolvePartyFields(
  kind: PartyKind,
  input: PartyFieldsInput,
  base?: PartyFields
): PartyFields {
  const pick = <K extends keyof PartyFields>(k: K): PartyFields[K] | null =>
    input[k] === undefined ? (base?.[k] ?? null) : (input[k] ?? null)

  const name = pick("name")
  if (!name) throw invalid("name", "Name is required.")
  const gstin = pick("gstin")
  // A new GSTIN brings its own registration type, state and PAN unless the
  // input sets them too.
  const gstinChanged = input.gstin !== undefined
  const registrationType =
    input.registrationType ??
    (base && !gstinChanged
      ? base.registrationType
      : defaultRegistrationType(gstin, base?.registrationType))

  const needsGstin = REGISTRATION_TYPES_WITH_GSTIN.includes(registrationType)
  if (needsGstin && !gstin)
    throw invalid("gstin", "A GSTIN is needed for this registration type.")
  if (!needsGstin && gstin)
    throw invalid(
      "registrationType",
      "Unregistered and overseas parties don't have a GSTIN."
    )

  const fromGstin = gstin ? gstin.slice(0, 2) : null
  const statePicked =
    input.stateCode === undefined && gstinChanged ? null : pick("stateCode")
  if (statePicked && fromGstin && statePicked !== fromGstin)
    throw invalid("stateCode", "State code doesn't match the GSTIN.")
  const stateCode = fromGstin ?? statePicked
  if (registrationType === "overseas" && stateCode)
    throw invalid("stateCode", "Overseas parties have no Indian state.")

  const panPicked = input.pan === undefined && gstinChanged ? null : pick("pan")
  const panOfGstin = gstin ? panFromGstin(gstin) : null
  if (panPicked && panOfGstin && panPicked !== panOfGstin)
    throw invalid("pan", "PAN doesn't match the GSTIN.")

  const defaultTdsSection = pick("defaultTdsSection")
  if (defaultTdsSection && kind !== "vendor")
    throw invalid(
      "defaultTdsSection",
      "Only vendors have a default TDS section."
    )

  return {
    name,
    legalName: pick("legalName"),
    gstin,
    pan: panOfGstin ?? panPicked,
    registrationType,
    stateCode,
    billingAddress: pick("billingAddress"),
    email: pick("email"),
    phone: pick("phone"),
    paymentTermsDays: pick("paymentTermsDays"),
    defaultTdsSection,
    msmeCategory: pick("msmeCategory"),
    udyamNumber: pick("udyamNumber"),
  }
}
