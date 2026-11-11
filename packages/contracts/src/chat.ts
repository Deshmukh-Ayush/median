// Ask Median: conversations and their messages. A conversation belongs to the
// member who started it; other members of the organisation can't see it.

import { z } from "zod"

import type { IsoTimestamp } from "./common"

export type ChatRole = "user" | "assistant" | "tool" | "system"

/** Where the chat was opened from, so answers can start from that page. */
export const pageContextSchema = z.object({
  /** App path, e.g. "/invoices/3f2a…". */
  path: z.string().startsWith("/").max(500),
  /** What the person was looking at, e.g. "Invoice INV/2026-27/0042". */
  label: z.string().trim().max(200).optional(),
  entity: z
    .object({
      type: z.string().trim().min(1).max(50),
      id: z.string().trim().min(1).max(100),
    })
    .optional(),
})
export type PageContext = z.infer<typeof pageContextSchema>

export const toolCallSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  /** The tool's arguments as the model sent them (validated by the tool). */
  args: z.json(),
})
export type ToolCall = z.infer<typeof toolCallSchema>

export interface Conversation {
  readonly id: string
  readonly title: string | null
  readonly pageContext: PageContext | null
  readonly createdAt: IsoTimestamp
  readonly lastMessageAt: IsoTimestamp
}

export interface ChatMessage {
  readonly id: string
  readonly conversationId: string
  readonly role: ChatRole
  readonly content: string
  readonly toolCalls: readonly ToolCall[] | null
  readonly toolCallId: string | null
  readonly createdAt: IsoTimestamp
}

/** A conversation with a page of its messages, oldest first. */
export interface ConversationWithMessages extends Conversation {
  readonly messages: readonly ChatMessage[]
  /** Pass back to load the messages before these. Null at the start. */
  readonly olderCursor: string | null
}

export const createConversationInputSchema = z.object({
  title: z.string().trim().min(1).max(200).nullish(),
  pageContext: pageContextSchema.nullish(),
})
export type CreateConversationInput = z.input<
  typeof createConversationInputSchema
>

export const appendMessageInputSchema = z
  .object({
    role: z.enum(["user", "assistant", "tool", "system"]),
    content: z.string().max(100_000),
    toolCalls: z.array(toolCallSchema).max(50).nullish(),
    toolCallId: z.string().min(1).max(100).nullish(),
  })
  .refine((m) => !m.toolCalls?.length || m.role === "assistant", {
    message: "Only assistant messages call tools.",
    path: ["toolCalls"],
  })
  .refine((m) => (m.role === "tool") === Boolean(m.toolCallId), {
    message: "A tool message needs the id of the call it answers, and only it.",
    path: ["toolCallId"],
  })
export type AppendMessageInput = z.input<typeof appendMessageInputSchema>
