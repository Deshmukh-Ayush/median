import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const statusChipVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "bg-hover text-fg-secondary",
        success: "bg-success-subtle text-success",
        warning: "bg-warning-subtle text-warning",
        danger: "bg-danger-subtle text-danger",
        info: "bg-info-subtle text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
)

type StatusTone = NonNullable<VariantProps<typeof statusChipVariants>["tone"]>

/** A short status label: "Paid", "Overdue", "Needs review". Never the accent. */
function StatusChip({
  className,
  tone = "neutral",
  dot = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof statusChipVariants> & {
    /** A leading dot in the tone's colour. */
    dot?: boolean
  }) {
  return (
    <span
      data-slot="status-chip"
      data-tone={tone}
      className={cn(statusChipVariants({ tone }), className)}
      {...props}
    >
      {dot ? (
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  )
}

export { StatusChip, statusChipVariants }
export type { StatusTone }
