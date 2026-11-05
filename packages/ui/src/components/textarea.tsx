import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-sm border border-input bg-surface px-2.5 py-2 text-sm transition-colors placeholder:text-fg-tertiary disabled:cursor-not-allowed disabled:border-subtle disabled:bg-app disabled:text-fg-disabled aria-invalid:border-danger",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
