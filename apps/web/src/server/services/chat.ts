import "server-only"

import {
  ServiceError,
  appendMessageInputSchema,
  createConversationInputSchema,
  idSchema,
  pageContextSchema,
  pageOptionsSchema,
  parseInput,
  toolCallSchema,
} from "@workspace/contracts"
import type {
  AppendMessageInput,
  ChatMessage,
  Conversation,
  ConversationWithMessages,
  CreateConversationInput,
  Page,
  PageOptions,
} from "@workspace/contracts"
import { and, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { getDb, withTransaction } from "../db"
import type { Tx } from "../db"
import { conversations, messages } from "../db/schema"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { decodeCursor, encodeCursor } from "./pagination"

/** Longest title taken from the first question. */
const TITLE_FROM_QUESTION = 80

const conversationColumns = {
  id: conversations.id,
  title: conversations.title,
  pageContext: conversations.pageContext,
  createdAt: conversations.createdAt,
  lastMessageAt: conversations.lastMessageAt,
  // Full precision (microseconds) for keyset cursors.
  sortKey: sql<string>`${conversations.lastMessageAt}::text`,
}

const messageColumns = {
  id: messages.id,
  conversationId: messages.conversationId,
  role: messages.role,
  content: messages.content,
  toolCalls: messages.toolCalls,
  toolCallId: messages.toolCallId,
  createdAt: messages.createdAt,
  sortKey: sql<string>`${messages.createdAt}::text`,
}

function toConversation(r: {
  id: string
  title: string | null
  pageContext: unknown
  createdAt: Date
  lastMessageAt: Date
}): Conversation {
  return {
    id: r.id,
    title: r.title,
    pageContext: pageContextSchema.safeParse(r.pageContext).data ?? null,
    createdAt: r.createdAt.toISOString(),
    lastMessageAt: r.lastMessageAt.toISOString(),
  }
}

const storedToolCalls = z.array(toolCallSchema)

function toMessage(r: {
  id: string
  conversationId: string
  role: ChatMessage["role"]
  content: string
  toolCalls: unknown
  toolCallId: string | null
  createdAt: Date
}): ChatMessage {
  return {
    id: r.id,
    conversationId: r.conversationId,
    role: r.role,
    content: r.content,
    toolCalls:
      r.toolCalls === null
        ? null
        : (storedToolCalls.safeParse(r.toolCalls).data ?? null),
    toolCallId: r.toolCallId,
    createdAt: r.createdAt.toISOString(),
  }
}

/** The caller's own conversation in this organisation, or NOT_FOUND. */
const mine = (ctx: OrgContext, id: string) =>
  and(
    eq(conversations.organizationId, ctx.orgId),
    eq(conversations.userId, ctx.userId),
    eq(conversations.id, id)
  )

async function loadOwn(
  db: Tx | ReturnType<typeof getDb>,
  ctx: OrgContext,
  id: string
) {
  const [row] = await db
    .select(conversationColumns)
    .from(conversations)
    .where(mine(ctx, id))
  if (!row) throw new ServiceError("NOT_FOUND", "Conversation not found.")
  return row
}

/** Starts a conversation for the signed-in member. */
export async function createConversation(
  ctx: OrgContext,
  input: CreateConversationInput = {}
): Promise<Conversation> {
  assertCan(ctx, "ledger", "read")
  const c = parseInput(createConversationInputSchema, input)
  const [row] = await getDb()
    .insert(conversations)
    .values({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      title: c.title ?? null,
      pageContext: c.pageContext ?? null,
    })
    .returning(conversationColumns)
  if (!row) throw new ServiceError("CONFLICT", "Couldn't start a conversation.")
  return toConversation(row)
}

/** The signed-in member's conversations, most recent message first. */
export async function listConversations(
  ctx: OrgContext,
  cursor: string | null,
  options: PageOptions = {}
): Promise<Page<Conversation>> {
  assertCan(ctx, "ledger", "read")
  const { limit } = parseInput(pageOptionsSchema, options)
  const after = decodeCursor(cursor)
  const rows = await getDb()
    .select(conversationColumns)
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, ctx.orgId),
        eq(conversations.userId, ctx.userId),
        after
          ? sql`(${conversations.lastMessageAt}, ${conversations.id}) < (${after.k}::timestamptz, ${after.id}::uuid)`
          : undefined
      )
    )
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .limit(limit + 1)
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return {
    items: items.map(toConversation),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ k: last.sortKey, id: last.id })
        : null,
  }
}

/**
 * A conversation with its latest messages (oldest first). Pass `olderCursor`
 * from a previous call to load the messages before those.
 */
export async function getConversation(
  ctx: OrgContext,
  id: string,
  olderCursor: string | null = null,
  options: PageOptions = {}
): Promise<ConversationWithMessages> {
  assertCan(ctx, "ledger", "read")
  const conversationId = parseInput(idSchema, id)
  const { limit } = parseInput(pageOptionsSchema, options)
  const before = decodeCursor(olderCursor)
  const db = getDb()
  const conversation = await loadOwn(db, ctx, conversationId)
  const rows = await db
    .select(messageColumns)
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, ctx.orgId),
        eq(messages.conversationId, conversationId),
        before
          ? sql`(${messages.createdAt}, ${messages.id}) < (${before.k}::timestamptz, ${before.id}::uuid)`
          : undefined
      )
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const oldest = page.at(-1)
  return {
    ...toConversation(conversation),
    messages: page.reverse().map(toMessage),
    olderCursor:
      rows.length > limit && oldest
        ? encodeCursor({ k: oldest.sortKey, id: oldest.id })
        : null,
  }
}

/**
 * Adds a message to the signed-in member's conversation and moves it to the
 * top of their list. The first question becomes the title if there's none.
 */
export async function appendMessage(
  ctx: OrgContext,
  conversationId: string,
  input: AppendMessageInput
): Promise<ChatMessage> {
  assertCan(ctx, "ledger", "read")
  const id = parseInput(idSchema, conversationId)
  const m = parseInput(appendMessageInputSchema, input)
  return withTransaction(async (tx) => {
    const conversation = await loadOwn(tx, ctx, id)
    const [row] = await tx
      .insert(messages)
      .values({
        organizationId: ctx.orgId,
        conversationId: id,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls?.length ? m.toolCalls : null,
        toolCallId: m.toolCallId ?? null,
      })
      .returning(messageColumns)
    if (!row) throw new ServiceError("CONFLICT", "Couldn't save the message.")
    const title =
      conversation.title ??
      (m.role === "user" && m.content.trim()
        ? (m.content.trim().split("\n")[0] ?? "").slice(0, TITLE_FROM_QUESTION)
        : null)
    await tx
      .update(conversations)
      .set({ lastMessageAt: row.createdAt, title })
      .where(mine(ctx, id))
    return toMessage(row)
  })
}
