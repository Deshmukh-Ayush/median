import "server-only"

import type { Page, PageOptions } from "@workspace/contracts"
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@workspace/contracts"
import type { UIMessage } from "ai"

import type { OrgContext } from "@/server/services"

/**
 * Ask Median conversations, per organisation and user.
 *
 * TEMPORARY: kept in memory until the backend adds a table (requested in the
 * end-of-day summary: ask_conversations and ask_messages, keyed by
 * organization_id first). History is lost on restart and isn't shared
 * between server instances. The functions below are the interface the
 * table-backed version will keep.
 */

export interface AskConversationSummary {
  readonly id: string
  readonly title: string
  readonly updatedAt: string
}

export interface AskConversation extends AskConversationSummary {
  readonly messages: readonly UIMessage[]
}

interface StoredConversation extends AskConversation {
  readonly orgId: string
  readonly userId: string
}

/** Oldest conversations past this are dropped, so memory stays bounded. */
const MAX_CONVERSATIONS_PER_USER = 50
const MAX_TITLE_LENGTH = 60

// On globalThis so dev-mode reloads don't wipe it.
const globalStore = globalThis as typeof globalThis & {
  __askConversations?: Map<string, StoredConversation>
}
function store(): Map<string, StoredConversation> {
  globalStore.__askConversations ??= new Map()
  return globalStore.__askConversations
}

const keyOf = (ctx: OrgContext, id: string) =>
  `${ctx.orgId}\u0000${ctx.userId}\u0000${id}`

function mine(ctx: OrgContext): StoredConversation[] {
  return [...store().values()]
    .filter((c) => c.orgId === ctx.orgId && c.userId === ctx.userId)
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)
    )
}

/** The first question, shortened: the conversation's name in the list. */
export function titleOf(messages: readonly UIMessage[]): string {
  const first = messages.find((m) => m.role === "user")
  const text =
    first?.parts
      .flatMap((p) => (p.type === "text" ? [p.text] : []))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim() ?? ""
  if (text.length === 0) return "New question"
  return text.length > MAX_TITLE_LENGTH
    ? `${text.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : text
}

/** Newest first, cursor-paginated (cursor: the last row's updatedAt|id). */
export function listAskConversations(
  ctx: OrgContext,
  cursor: string | null,
  options: PageOptions = {}
): Page<AskConversationSummary> {
  const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  const all = mine(ctx)
  const start = cursor
    ? all.findIndex((c) => `${c.updatedAt}|${c.id}` === cursor) + 1
    : 0
  const items = all.slice(start, start + limit)
  const last = items.at(-1)
  const hasMore = start + limit < all.length
  return {
    items: items.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
    nextCursor: hasMore && last ? `${last.updatedAt}|${last.id}` : null,
  }
}

/** The caller's own conversation, or null (another user's is never found). */
export function getAskConversation(
  ctx: OrgContext,
  id: string
): AskConversation | null {
  const found = store().get(keyOf(ctx, id))
  if (!found) return null
  const { orgId: _org, userId: _user, ...conversation } = found
  return conversation
}

export function saveAskConversation(
  ctx: OrgContext,
  id: string,
  messages: readonly UIMessage[],
  now: Date = new Date()
): void {
  const key = keyOf(ctx, id)
  store().set(key, {
    id,
    orgId: ctx.orgId,
    userId: ctx.userId,
    title: titleOf(messages),
    updatedAt: now.toISOString(),
    messages,
  })
  for (const old of mine(ctx).slice(MAX_CONVERSATIONS_PER_USER)) {
    store().delete(keyOf(ctx, old.id))
  }
}

/** Tests only. */
export function clearAskConversations(): void {
  store().clear()
}
