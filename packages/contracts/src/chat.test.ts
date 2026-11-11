import { describe, expect, it } from "vitest"

import { appendMessageInputSchema, pageContextSchema } from "./chat"

describe("appendMessageInputSchema", () => {
  it("accepts a question, an answer with tool calls, and a tool result", () => {
    expect(
      appendMessageInputSchema.safeParse({ role: "user", content: "Cash?" })
        .success
    ).toBe(true)
    expect(
      appendMessageInputSchema.safeParse({
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_1",
            name: "getCashPosition",
            args: { asOf: "2026-11-12" },
          },
        ],
      }).success
    ).toBe(true)
    expect(
      appendMessageInputSchema.safeParse({
        role: "tool",
        content: '{"cash":"137021.10"}',
        toolCallId: "call_1",
      }).success
    ).toBe(true)
  })

  it("rejects tool calls on a user message and a tool result without its call id", () => {
    expect(
      appendMessageInputSchema.safeParse({
        role: "user",
        content: "x",
        toolCalls: [{ id: "c", name: "n", args: {} }],
      }).success
    ).toBe(false)
    expect(
      appendMessageInputSchema.safeParse({ role: "tool", content: "x" }).success
    ).toBe(false)
    expect(
      appendMessageInputSchema.safeParse({
        role: "user",
        content: "x",
        toolCallId: "c",
      }).success
    ).toBe(false)
  })
})

describe("pageContextSchema", () => {
  it("takes an app path, with an optional label and entity", () => {
    expect(
      pageContextSchema.safeParse({
        path: "/invoices/abc",
        label: "Invoice INV/2026-27/0001",
        entity: { type: "invoice", id: "abc" },
      }).success
    ).toBe(true)
    expect(
      pageContextSchema.safeParse({ path: "https://x.test" }).success
    ).toBe(false)
  })
})
