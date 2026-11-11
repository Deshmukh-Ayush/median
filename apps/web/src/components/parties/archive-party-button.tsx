"use client"

import { useActionState } from "react"

import { Button } from "@workspace/ui/components/button"

import { setPartyArchivedFromForm } from "@/app/(app)/parties/actions"
import { FormError } from "@/components/forms/field"
import { EMPTY_FORM_STATE } from "@/lib/form-state"

/** Archive (hide from pickers, keep history) or restore a party. */
export function ArchivePartyButton({
  id,
  archived,
}: {
  id: string
  archived: boolean
}) {
  const [state, action, pending] = useActionState(
    setPartyArchivedFromForm,
    EMPTY_FORM_STATE
  )
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="archive" value={archived ? "false" : "true"} />
      <Button type="submit" size="sm" loading={pending}>
        {archived ? "Restore" : "Archive"}
      </Button>
      <FormError message={state.error} />
    </form>
  )
}
