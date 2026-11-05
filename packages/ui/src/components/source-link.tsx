import * as React from "react"
import { cn } from "cn"
import {
  CreditCardIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  LoaderCircleIcon,
  MailIcon,
} from "lucide-react"

const ICONS = {
  document: FileTextIcon,
  image: FileImageIcon,
  sheet: FileSpreadsheetIcon,
  email: MailIcon,
  payment: CreditCardIcon,
} as const

type SourceKind = keyof typeof ICONS

type SourceLinkProps = Omit<React.ComponentProps<"a">, "href"> & {
  /** Where the source document opens. Without it the link is disabled. */
  href?: string
  kind?: SourceKind
  loading?: boolean
}

/** Opens the document behind an entry: the bill, statement or payment. */
function SourceLink({
  href,
  kind = "document",
  loading = false,
  className,
  children,
  ...props
}: SourceLinkProps) {
  const Icon = loading ? LoaderCircleIcon : ICONS[kind]
  const classes = cn(
    "-mx-1 inline-flex h-6 max-w-full items-center gap-1.5 rounded-sm px-1 text-sm text-fg-secondary transition-colors [&>svg]:size-3.5 [&>svg]:shrink-0",
    className
  )
  if (!href || loading) {
    return (
      <span
        data-slot="source-link"
        aria-disabled
        aria-busy={loading || undefined}
        className={cn(classes, !loading && "text-fg-disabled")}
      >
        <Icon aria-hidden className={cn(loading && "animate-spin")} />
        <span className="truncate">
          {loading ? "Loading source…" : (children ?? "No source document")}
        </span>
      </span>
    )
  }
  return (
    <a
      data-slot="source-link"
      href={href}
      className={cn(
        classes,
        "hover:bg-hover hover:text-fg active:bg-selected active:text-fg"
      )}
      {...props}
    >
      <Icon aria-hidden />
      <span className="truncate underline decoration-input underline-offset-2">
        {children}
      </span>
    </a>
  )
}

export { SourceLink }
export type { SourceKind, SourceLinkProps }
