"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { authErrorMessage } from "@/lib/auth-errors"
import { fieldErrorsOf, formValues } from "@/lib/form-state"
import type { FormState } from "@/lib/form-state"
import { INVITABLE_ROLES, can } from "@/lib/permissions"
import { getAuth } from "@/server/auth"
import { getServerEnv } from "@/server/env"

import { getOrgContextOrRedirect } from "../../org-context"

export interface InviteState extends FormState {
  /** Share this with the invitee: no invitation email is sent yet. */
  readonly inviteLink?: string
  readonly invitedEmail?: string
}

const inviteSchema = z.object({
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  role: z.enum(INVITABLE_ROLES, "Pick a role."),
})

export async function inviteMember(
  _previous: InviteState,
  formData: FormData
): Promise<InviteState> {
  const ctx = await getOrgContextOrRedirect()
  if (!can(ctx.role, { resource: "invitation", action: "create" })) {
    return { error: "Only owners can invite people." }
  }
  const raw = formValues(formData, ["email", "role"])
  const parsed = inviteSchema.safeParse(raw)
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error), values: raw }
  }
  let invitationId: string
  try {
    const invitation = await getAuth().api.createInvitation({
      body: { email: parsed.data.email, role: parsed.data.role },
      headers: await headers(),
    })
    invitationId = invitation.id
  } catch (error) {
    const message = authErrorMessage(error)
    if (message === null) throw error
    return { error: message, values: raw }
  }
  revalidatePath("/settings/members")
  const link = new URL(
    `/accept-invitation/${invitationId}`,
    getServerEnv().BETTER_AUTH_URL
  )
  return { inviteLink: link.toString(), invitedEmail: parsed.data.email }
}
