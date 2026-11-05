import type { Metadata } from "next"
import { headers } from "next/headers"
import Link from "next/link"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Logo } from "@workspace/ui/components/logo"

import { authErrorMessage } from "@/lib/auth-errors"
import { ROLE_LABELS, isOrgRole } from "@/lib/permissions"
import { getAuth } from "@/server/auth"

import { acceptInvitation } from "./actions"

export const metadata: Metadata = { title: "Join an organisation · Median" }

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-app px-4 py-12">
      <Logo />
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-default bg-surface p-6">
        {children}
      </div>
    </main>
  )
}

export default async function AcceptInvitationPage(
  props: PageProps<"/accept-invitation/[id]">
) {
  const { id } = await props.params
  const { error: errorParam } = await props.searchParams
  const requestHeaders = await headers()
  const auth = getAuth()
  const session = await auth.api.getSession({ headers: requestHeaders })
  const here = `/accept-invitation/${encodeURIComponent(id)}`

  if (!session) {
    return (
      <Frame>
        <h1 className="font-display text-lg font-semibold">
          You&apos;ve been invited to Median
        </h1>
        <p className="text-sm text-fg-secondary">
          Sign in, or create an account with the email the invite was sent to.
        </p>
        <div className="flex gap-2">
          <Link
            href={`/sign-up?redirectTo=${encodeURIComponent(here)}`}
            className={buttonVariants({ variant: "primary" })}
          >
            Create account
          </Link>
          <Link
            href={`/sign-in?redirectTo=${encodeURIComponent(here)}`}
            className={buttonVariants({ variant: "secondary" })}
          >
            Sign in
          </Link>
        </div>
      </Frame>
    )
  }

  let invitation: Awaited<ReturnType<typeof auth.api.getInvitation>> | null =
    null
  let loadError: string | null = null
  try {
    invitation = await auth.api.getInvitation({
      query: { id },
      headers: requestHeaders,
    })
  } catch (error) {
    loadError = authErrorMessage(error)
    if (loadError === null) throw error
  }

  if (!invitation) {
    return (
      <Frame>
        <h1 className="font-display text-lg font-semibold">
          This invite can&apos;t be used
        </h1>
        <p role="alert" className="text-sm text-danger">
          {loadError ?? "This invite no longer exists. Ask for a new one."}
        </p>
        <p className="text-sm text-fg-secondary">
          You&apos;re signed in as {session.user.email}.
        </p>
      </Frame>
    )
  }

  const role = invitation.role.split(",")[0]?.trim() ?? ""
  const error = typeof errorParam === "string" ? errorParam : undefined
  return (
    <Frame>
      <h1 className="font-display text-lg font-semibold">
        Join {invitation.organizationName}
      </h1>
      <p className="text-sm text-fg-secondary">
        {invitation.inviterEmail} invited you as{" "}
        <span className="font-medium text-fg">
          {isOrgRole(role) ? ROLE_LABELS[role] : role}
        </span>
        .
      </p>
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}
      <form action={acceptInvitation.bind(null, id)}>
        <Button type="submit" variant="primary" className="w-full">
          Join {invitation.organizationName}
        </Button>
      </form>
    </Frame>
  )
}
