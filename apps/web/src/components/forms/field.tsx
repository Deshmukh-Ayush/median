import * as React from "react"
import { cn } from "cn"

import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

/** A labelled input with hint and error, wired up for screen readers. */
export function Field({
  name,
  label,
  hint,
  error,
  className,
  ...inputProps
}: Omit<React.ComponentProps<"input">, "name"> & {
  name: string
  label: string
  hint?: React.ReactNode
  error?: string | undefined
}) {
  const id = `field-${name}`
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-fg-secondary">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** A form-level error, announced when it appears. */
export function FormError({ message }: { message?: string | undefined }) {
  if (!message) return null
  return (
    <p
      role="alert"
      className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger"
    >
      {message}
    </p>
  )
}
