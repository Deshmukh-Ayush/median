import { isServiceError } from "@workspace/contracts"
import {
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
} from "ai"

import { todayIso } from "@/lib/format-date"
import {
  ASK_EMPTY_ANSWER,
  ask,
  askRequestSchema,
  isCompleteAnswer,
} from "@/server/ai/ask/ask"
import {
  getAskConversation,
  saveAskConversation,
} from "@/server/ai/ask/conversations"
import { requireRealDataAllowed } from "@/server/ai/models"
import { requireOrgContext } from "@/server/services"

// A question can take a few tool rounds.
export const maxDuration = 60

/** One retry when the model ends without a usable answer. */
const ATTEMPTS = 2

function errorResponse(status: number, message: string): Response {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  )
}

/**
 * Ask Median: answers a question about the signed-in user's books, streamed
 * as AI SDK UI messages. Read-only: the model's tools only read services.
 */
export async function POST(request: Request): Promise<Response> {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (error) {
    if (isServiceError(error)) return errorResponse(401, error.message)
    throw error
  }

  // The books go to the AI provider: never to a free-tier key in production.
  try {
    requireRealDataAllowed()
  } catch (error) {
    if (isServiceError(error)) return errorResponse(403, error.message)
    throw error
  }

  const body: unknown = await request.json().catch(() => null)
  const parsed = askRequestSchema.safeParse(body)
  if (!parsed.success) return errorResponse(400, "That question can't be sent.")
  const { conversationId, message, pageContext } = parsed.data

  const history = getAskConversation(ctx, conversationId)?.messages ?? []
  const messages = [...history, message]

  return createUIMessageStreamResponse({
    headers: { "Cache-Control": "no-store" },
    stream: createUIMessageStream({
      originalMessages: messages,
      generateId: createIdGenerator({ prefix: "ask", size: 16 }),
      execute: async ({ writer }) => {
        writer.write({ type: "start" })
        // An empty or cut-off answer (a reasoning model that spent its
        // budget thinking) is retried once, then replaced by a plain
        // message, never a blank bubble.
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
          const result = await ask(ctx, {
            messages,
            pageContext,
            conversationId,
            today: todayIso(),
            abortSignal: request.signal,
          })
          writer.merge(
            toUIMessageStream({
              stream: result.stream,
              sendStart: false,
              sendFinish: false,
            })
          )
          const [text, finishReason] = await Promise.all([
            result.text,
            result.finishReason,
          ])
          if (isCompleteAnswer(text, finishReason)) break
          console.warn("[ask] incomplete answer", {
            attempt,
            finishReason,
            textChars: text.trim().length,
          })
          if (attempt === ATTEMPTS) {
            const id = "ask-empty"
            writer.write({ type: "text-start", id })
            writer.write({ type: "text-delta", id, delta: ASK_EMPTY_ANSWER })
            writer.write({ type: "text-end", id })
          }
        }
        writer.write({ type: "finish" })
        writer.setOutcome({ status: "completed" })
      },
      onEnd: ({ messages: all }) => {
        saveAskConversation(ctx, conversationId, all)
      },
      onError: (error) => {
        console.error("[ask] answer failed", error)
        return "Something went wrong while answering. Try again."
      },
    }),
  })
}
