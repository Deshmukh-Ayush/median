import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { LoaderCircleIcon } from "lucide-react"

/**
 * Buttons are neutral by default. `primary` is the only place the brand accent
 * appears outside the logo: use it for the one action a view needs from the
 * user ("Approve", "Connect Razorpay", "Create invoice"), at most once per view.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-default items-center justify-center gap-1.5 rounded-md border text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color] select-none disabled:pointer-events-none aria-invalid:border-danger data-[loading]:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-accent-button font-semibold text-on-accent hover:bg-accent-button-hover active:bg-accent-button-hover disabled:opacity-50",
        secondary:
          "border-default bg-surface text-fg hover:bg-hover active:bg-selected disabled:border-subtle disabled:text-fg-disabled aria-expanded:bg-hover",
        ghost:
          "border-transparent bg-transparent text-fg hover:bg-hover active:bg-selected disabled:text-fg-disabled aria-expanded:bg-hover",
        danger:
          "border-default bg-surface text-danger hover:bg-danger-subtle active:bg-danger-subtle disabled:border-subtle disabled:text-fg-disabled",
      },
      size: {
        sm: "h-7 px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-8 px-3",
        lg: "h-9 px-3.5",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-8",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
)

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Shows a spinner, sets aria-busy and blocks clicks. */
    loading?: boolean
  }

function Button({
  className,
  variant = "secondary",
  size = "default",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-loading={loading ? "" : undefined}
      aria-busy={loading || undefined}
      disabled={disabled === true || loading}
      focusableWhenDisabled={loading}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? (
        <LoaderCircleIcon aria-hidden className="animate-spin" />
      ) : null}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
