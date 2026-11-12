import { getToolName, isTextUIPart, isToolUIPart } from "ai"
import type { UIMessage } from "ai"
import { z } from "zod"

import { ASK_TOOL_LABELS, isAskToolName } from "./ask-tools"
import type { AskSource } from "./ask-tools"
import { isAppHref } from "./ask-markdown"

/** One tool call under a question, as the UI shows it. */
export interface AskStep {
  readonly id: string
  readonly label: string
  readonly status: "running" | "done" | "error"
}

// Tool output reaches the client as unknown JSON: parse before use.
const toolOutputSchema = z.object({
  ok: z.literal(true),
  sources: z.array(z.object({ title: z.string(), href: z.string() })),
})
const toolFailureSchema = z.object({ ok: z.literal(false) })

export function askSteps(message: UIMessage): AskStep[] {
  return message.parts.filter(isToolUIPart).map((part) => {
    const name = getToolName(part)
    const label = isAskToolName(name) ? ASK_TOOL_LABELS[name] : name
    const status =
      part.state === "output-error" ||
      part.state === "output-denied" ||
      (part.state === "output-available" &&
        toolFailureSchema.safeParse(part.output).success)
        ? "error"
        : part.state === "output-available"
          ? "done"
          : "running"
    return { id: part.toolCallId, label, status }
  })
}

/** Every page the answer's tools read from, in order, without repeats. */
export function askSources(message: UIMessage): AskSource[] {
  const seen = new Set<string>()
  const out: AskSource[] = []
  for (const part of message.parts) {
    if (!isToolUIPart(part) || part.state !== "output-available") continue
    const parsed = toolOutputSchema.safeParse(part.output)
    if (!parsed.success) continue
    for (const source of parsed.data.sources) {
      if (!isAppHref(source.href) || seen.has(source.href)) continue
      seen.add(source.href)
      out.push(source)
    }
  }
  return out
}

/** The answer's text, all text parts joined. */
export function askText(message: UIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((p) => p.text)
    .join("\n\n")
    .trim()
}
