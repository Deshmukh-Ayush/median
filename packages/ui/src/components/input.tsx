import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-sm border border-input bg-surface px-2.5 py-1 text-sm transition-colors file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-fg-tertiary disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-faint disabled:bg-subtle disabled:text-fg-disabled aria-invalid:border-danger",
        className
      )}
      {...props}
    />
  )
}

export { Input }
