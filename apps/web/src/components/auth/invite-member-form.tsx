"use client"

import { useActionState, useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import { inviteMember } from "@/app/(app)/settings/members/actions"
import type { InviteState } from "@/app/(app)/settings/members/actions"
import { Field, FormError } from "@/components/forms/field"

const INITIAL: InviteState = {}

export interface RoleOption {
  value: string
  label: string
  description: string
}

export function InviteMemberForm({ roles }: { roles: readonly RoleOption[] }) {
  const [state, action, pending] = useActionState(inviteMember, INITIAL)
  const [copied, setCopied] = useState(false)
  const roleError = state.fieldErrors?.role

  async function copy(link: string) {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4" noValidate>
        <Field
          name="email"
          label="Email"
          type="email"
          autoComplete="off"
          required
          placeholder="ca@example.in"
          defaultValue={state.values?.email}
          error={state.fieldErrors?.email}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="field-role">Role</Label>
          <select
            id="field-role"
            name="role"
            defaultValue={state.values?.role ?? "finance"}
            aria-invalid={roleError ? true : undefined}
            aria-describedby="field-role-hint"
            className="h-8 rounded-sm border border-input bg-surface px-2 text-sm aria-invalid:border-danger"
          >
            {roles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
          <ul
            id="field-role-hint"
            className="flex flex-col gap-0.5 text-xs text-fg-secondary"
          >
            {roles.map((role) => (
              <li key={role.value}>
                <span className="font-medium text-fg">{role.label}:</span>{" "}
                {role.description}
              </li>
            ))}
          </ul>
          {roleError ? (
            <p className="text-xs text-danger">{roleError}</p>
          ) : null}
        </div>
        <FormError message={state.error} />
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          className="self-start"
        >
          Create invite link
        </Button>
      </form>

      {state.inviteLink ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-md border border-default bg-app p-3"
        >
          <p className="text-sm">
            Invite ready for{" "}
            <span className="font-medium">{state.invitedEmail}</span>. Send them
            this link; it works once they sign in with that email.
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              aria-label="Invite link"
              value={state.inviteLink}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              type="button"
              onClick={() => void copy(state.inviteLink ?? "")}
              aria-label="Copy invite link"
            >
              {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
