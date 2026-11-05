import * as React from "react"
import { cn } from "cn"

/** The Median mark: three bars cut by a centre line, on the brand colour. */
function LogoMark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      data-slot="logo-mark"
      className={cn("size-6 shrink-0", className)}
      {...props}
    >
      <rect width="24" height="24" rx="6" className="fill-accent-brand" />
      <rect x="6" y="8" width="2.5" height="8" rx="1.25" fill="#fff" />
      <rect x="10.75" y="5.5" width="2.5" height="13" rx="1.25" fill="#fff" />
      <rect x="15.5" y="9.5" width="2.5" height="5" rx="1.25" fill="#fff" />
      <rect
        x="4.5"
        y="11.25"
        width="15"
        height="1.5"
        rx="0.75"
        fill="#fff"
        opacity="0.55"
      />
    </svg>
  )
}

function Logo({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="logo"
      className={cn("inline-flex items-center gap-2", className)}
      {...props}
    >
      <LogoMark />
      <span className="text-sm font-semibold text-fg">Median</span>
    </span>
  )
}

export { Logo, LogoMark }
