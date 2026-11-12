"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useState } from "react"
import { Maximize2Icon, MessageSquareIcon, PlusIcon } from "lucide-react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@workspace/ui/components/sheet"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { pageContextFromRoute } from "@/lib/ask-page-context"

import { useAskSelectedIds } from "./ask-selection"

// The chat (useChat, the AI SDK and zod) loads the first time the sheet
// opens, never with the page.
const AskChat = dynamic(() => import("./ask-chat").then((m) => m.AskChat), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 flex-col justify-end gap-2 p-4">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-20" />
    </div>
  ),
})

const CONTEXT_SUGGESTIONS: Record<string, readonly string[]> = {
  invoices: [
    "Has this invoice been paid?",
    "How much does this customer owe in total?",
  ],
  parties: [
    "How much have we invoiced this customer?",
    "Do they owe us anything right now?",
  ],
  gst: [
    "How much GST is due for this month?",
    "What input tax credit do we have?",
  ],
  reports: [
    "What's the net profit for this period?",
    "What were the biggest expenses?",
  ],
  inbox: ["What is this item?", "How many items are waiting for review?"],
}

/**
 * The top-bar "Ask" button: Ask Median in a right-side sheet, told which
 * page, record and period the user is looking at. The conversation carries
 * on across pages until "New", and "Open in full" continues it on /ask.
 */
export function AskSheet() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedIds = useAskSelectedIds()
  const pageContext = pageContextFromRoute(pathname, searchParams, selectedIds)

  const [open, setOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [answered, setAnswered] = useState(false)

  // "This invoice" suggestions only make sense with a record in focus.
  const section = pathname.split("/")[1] ?? ""
  const needsRecord = ["invoices", "parties", "inbox"].includes(section)
  const suggestions =
    needsRecord && pageContext.ids.length === 0
      ? undefined
      : CONTEXT_SUGGESTIONS[section]

  // /ask is the full view already.
  if (pathname === "/ask") return null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next && !conversationId) setConversationId(crypto.randomUUID())
      }}
    >
      <SheetTrigger
        render={
          <Button variant="secondary" size="sm" aria-label="Ask Median" />
        }
      >
        <MessageSquareIcon aria-hidden />
        Ask
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-md"
        showCloseButton
      >
        <SheetHeader className="border-b border-subtle">
          <SheetTitle>Ask Median</SheetTitle>
          <SheetDescription>
            About this page and your books. Read-only.
          </SheetDescription>
          <div className="flex gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setConversationId(crypto.randomUUID())
                setAnswered(false)
              }}
            >
              <PlusIcon aria-hidden />
              New
            </Button>
            <Link
              href={
                answered && conversationId ? `/ask?c=${conversationId}` : "/ask"
              }
              onClick={() => setOpen(false)}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              <Maximize2Icon aria-hidden />
              Open in full
            </Link>
          </div>
        </SheetHeader>
        {conversationId ? (
          <AskChat
            key={conversationId}
            conversationId={conversationId}
            pageContext={pageContext}
            {...(suggestions ? { suggestions } : {})}
            onAnswered={() => setAnswered(true)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
