"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { authErrorMessage } from "@/lib/auth-errors"
import { getAuth } from "@/server/auth"

export async function acceptInvitation(invitationId: string): Promise<void> {
  const requestHeaders = await headers()
  const auth = getAuth()
  let organizationId: string
  try {
    const result = await auth.api.acceptInvitation({
      body: { invitationId },
      headers: requestHeaders,
    })
    if (!result) throw new Error("Invitation could not be accepted.")
    organizationId = result.invitation.organizationId
  } catch (error) {
    const message = authErrorMessage(error)
    if (message === null) throw error
    redirect(
      `/accept-invitation/${encodeURIComponent(invitationId)}?error=${encodeURIComponent(message)}`
    )
  }
  await auth.api.setActiveOrganization({
    body: { organizationId },
    headers: requestHeaders,
  })
  redirect("/")
}

/**
 * Signs out and returns to sign-in, which comes back to this invite. For when
 * the invite was sent to a different email than the signed-in account.
 */
export async function signOutToAcceptInvitation(
  invitationId: string
): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() })
  const here = `/accept-invitation/${encodeURIComponent(invitationId)}`
  redirect(`/sign-in?redirectTo=${encodeURIComponent(here)}`)
}
