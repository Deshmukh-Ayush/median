import { expect, it } from "vitest"

import { getDb } from "../src/server/db"
import { member, user } from "../src/server/db/schema"
import {
  appendMessage,
  createConversation,
  getConversation,
  listConversations,
} from "../src/server/services/chat"
import { freshDevOrg } from "./setup"

it("Ask Median conversations: private to their member, ordered, paged", async () => {
  const ctx = await freshDevOrg("chat")
  const first = await createConversation(ctx, {
    pageContext: { path: "/cash", label: "Cash" },
  })
  expect(first).toMatchObject({ title: null, pageContext: { path: "/cash" } })

  // The first question names the conversation; tool calls round-trip.
  await appendMessage(ctx, first.id, {
    role: "user",
    content: "How much cash do we have?\nInclude Razorpay.",
  })
  await appendMessage(ctx, first.id, {
    role: "assistant",
    content: "",
    toolCalls: [
      { id: "call_1", name: "getCashPosition", args: { asOf: null } },
    ],
  })
  await appendMessage(ctx, first.id, {
    role: "tool",
    content: '{"bank":"137021.10"}',
    toolCallId: "call_1",
  })
  await appendMessage(ctx, first.id, {
    role: "assistant",
    content: "₹1,37,021.10 in the bank.",
  })
  const read = await getConversation(ctx, first.id)
  expect(read.title).toBe("How much cash do we have?")
  expect(read.messages.map((m) => m.role)).toEqual([
    "user",
    "assistant",
    "tool",
    "assistant",
  ])
  expect(read.messages[1]?.toolCalls).toEqual([
    { id: "call_1", name: "getCashPosition", args: { asOf: null } },
  ])
  expect(read.olderCursor).toBeNull()

  // Older messages page backwards, oldest first within a page.
  const latest = await getConversation(ctx, first.id, null, { limit: 3 })
  expect(latest.messages.map((m) => m.role)).toEqual([
    "assistant",
    "tool",
    "assistant",
  ])
  const older = await getConversation(ctx, first.id, latest.olderCursor, {
    limit: 3,
  })
  expect(older.messages.map((m) => m.content)).toEqual([
    "How much cash do we have?\nInclude Razorpay.",
  ])
  expect(older.olderCursor).toBeNull()

  // A newer conversation with a message goes to the top.
  const second = await createConversation(ctx, { title: "GST for October" })
  await appendMessage(ctx, second.id, { role: "user", content: "Tax due?" })
  const list = await listConversations(ctx, null, { limit: 1 })
  expect(list.items.map((c) => c.title)).toEqual(["GST for October"])
  const rest = await listConversations(ctx, list.nextCursor, { limit: 1 })
  expect(rest.items.map((c) => c.id)).toEqual([first.id])

  // Another member of the same organisation can't see or add to it.
  const db = getDb()
  const otherId = `${ctx.orgId}-other`
  await db.insert(user).values({
    id: otherId,
    name: "Other member",
    email: `${otherId}@example.invalid`,
    emailVerified: true,
  })
  await db.insert(member).values({
    id: `${otherId}-member`,
    organizationId: ctx.orgId,
    userId: otherId,
    role: "finance",
    createdAt: new Date(),
  })
  const other = { ...ctx, userId: otherId, role: "finance" as const }
  expect((await listConversations(other, null)).items).toEqual([])
  await expect(getConversation(other, first.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  })
  await expect(
    appendMessage(other, first.id, { role: "user", content: "hi" })
  ).rejects.toMatchObject({ code: "NOT_FOUND" })
})
