import { randomUUID } from "node:crypto"

import type { Metadata } from "next"
import Link from "next/link"
import { MessageSquareIcon, PlusIcon } from "lucide-react"

import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { AskPageChat } from "@/components/ask/ask-page-chat"
import { PlaceholderPage } from "@/components/shell/placeholder-page"
import type { SearchParams } from "@/lib/page-props"
import { firstParam, idParam } from "@/lib/report-params"
import {
  getAskConversation,
  listAskConversations,
} from "@/server/ai/ask/conversations"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "Ask Median · Median" }

const TITLE = "Ask Median"
const DESCRIPTION =
  "Questions about your books, answered from your ledger with a link to each figure."

/** Conversations shown per page in the list. */
const LIST_LIMIT = 30

export default async function AskPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { ctx, allowed } = await getPageContext("/ask")
  if (!allowed) {
    return (
      <PlaceholderPage
        title={TITLE}
        description={DESCRIPTION}
        icon={MessageSquareIcon}
        emptyTitle=""
        emptyDescription=""
        allowed={false}
        role={ctx.role}
      />
    )
  }

  const params = await searchParams
  const requested = idParam(params.c)
  const conversation = requested ? getAskConversation(ctx, requested) : null
  // A link to someone else's (or a forgotten) conversation opens a new one.
  const conversationId = conversation?.id ?? randomUUID()
  const list = listAskConversations(ctx, firstParam(params.cursor) ?? null, {
    limit: LIST_LIMIT,
  })

  return (
    <div className="flex h-[calc(100dvh-var(--topbar-height))] min-h-0">
      <nav
        aria-label="Conversations"
        className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-subtle p-3 md:flex"
      >
        <Link
          href="/ask"
          className={cn(
            buttonVariants({ variant: "secondary", size: "sm" }),
            "mb-2 justify-start"
          )}
        >
          <PlusIcon aria-hidden />
          New question
        </Link>
        {list.items.length === 0 ? (
          <p className="px-2 text-xs text-fg-tertiary">
            Your questions show up here.
          </p>
        ) : (
          list.items.map((c) => (
            <Link
              key={c.id}
              href={`/ask?c=${c.id}`}
              aria-current={c.id === conversationId ? "page" : undefined}
              className="truncate rounded-md px-2 py-1.5 text-sm text-fg-secondary hover:bg-hover hover:text-fg aria-[current=page]:bg-selected aria-[current=page]:text-fg"
            >
              {c.title}
            </Link>
          ))
        )}
        {list.nextCursor ? (
          <Link
            href={`/ask?cursor=${encodeURIComponent(list.nextCursor)}${conversation ? `&c=${conversation.id}` : ""}`}
            className="px-2 py-1.5 text-xs text-fg-tertiary hover:text-fg"
          >
            Older
          </Link>
        ) : null}
        <p className="mt-auto px-2 pt-3 text-2xs text-fg-tertiary">
          History is kept for this session only, for now.
        </p>
      </nav>

      <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <header className="shrink-0 px-4 pt-6 pb-2">
          <h1 className="font-display text-xl font-semibold">{TITLE}</h1>
          <p className="text-sm text-fg-secondary">{DESCRIPTION}</p>
        </header>
        <AskPageChat
          conversationId={conversationId}
          initialMessages={conversation?.messages ?? []}
        />
      </section>
    </div>
  )
}
