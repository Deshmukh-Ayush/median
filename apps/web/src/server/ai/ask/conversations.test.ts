import type { UIMessage } from "ai"
import { beforeEach, describe, expect, it } from "vitest"

import {
  clearAskConversations,
  getAskConversation,
  listAskConversations,
  saveAskConversation,
  titleOf,
} from "./conversations"

const alice = { orgId: "org_1", userId: "alice", role: "owner" } as const
const bob = { orgId: "org_1", userId: "bob", role: "owner" } as const
const aliceElsewhere = { ...alice, orgId: "org_2" }

const question = (text: string): UIMessage => ({
  id: `m-${text}`,
  role: "user",
  parts: [{ type: "text", text }],
})

beforeEach(() => clearAskConversations())

describe("Ask Median conversations (in memory)", () => {
  it("are private to the user and the organisation", () => {
    saveAskConversation(alice, "c1", [question("What's my cash?")])
    expect(getAskConversation(alice, "c1")?.title).toBe("What's my cash?")
    expect(getAskConversation(bob, "c1")).toBeNull()
    expect(getAskConversation(aliceElsewhere, "c1")).toBeNull()
    expect(listAskConversations(bob, null).items).toEqual([])
  })

  it("lists newest first with a cursor", () => {
    for (let i = 0; i < 5; i++) {
      saveAskConversation(
        alice,
        `c${i}`,
        [question(`Q${i}`)],
        new Date(Date.UTC(2026, 10, 12, 10, i))
      )
    }
    const first = listAskConversations(alice, null, { limit: 2 })
    expect(first.items.map((c) => c.id)).toEqual(["c4", "c3"])
    const second = listAskConversations(alice, first.nextCursor, { limit: 2 })
    expect(second.items.map((c) => c.id)).toEqual(["c2", "c1"])
    const last = listAskConversations(alice, second.nextCursor, { limit: 2 })
    expect(last.items.map((c) => c.id)).toEqual(["c0"])
    expect(last.nextCursor).toBeNull()
  })

  it("keeps at most 50 per user, dropping the oldest", () => {
    for (let i = 0; i < 52; i++) {
      saveAskConversation(
        alice,
        `c${i}`,
        [question(`Q${i}`)],
        new Date(Date.UTC(2026, 10, 12, 0, i))
      )
    }
    expect(getAskConversation(alice, "c0")).toBeNull()
    expect(getAskConversation(alice, "c1")).toBeNull()
    expect(getAskConversation(alice, "c51")).not.toBeNull()
  })

  it("names a conversation after its first question, shortened", () => {
    expect(titleOf([])).toBe("New question")
    const long =
      "How much do customers owe us that is more than ninety days overdue right now?"
    const title = titleOf([question(long)])
    expect(title.length).toBeLessThanOrEqual(60)
    expect(title.endsWith("…")).toBe(true)
  })
})
