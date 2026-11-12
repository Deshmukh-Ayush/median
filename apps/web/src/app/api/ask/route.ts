import { isServiceError } from "@workspace/contracts"
import {
  createIdGenerator,
  createUIMessageStreamResponse,
  toUIMessageStream,
} from "ai"

import { todayIso } from "@/lib/format-date"
import { ask, askRequestSchema } from "@/server/ai/ask/ask"
import {
  getAskConversation,
  saveAskConversation,
} from "@/server/ai/ask/conversations"
import { requireRealDataAllowed } from "@/server/ai/models"
import { requireOrgContext } from "@/server/services"

// A question can take a few tool rounds.
export const maxDuration = 60

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

  const result = await ask(ctx, {
    messages,
    pageContext,
    today: todayIso(),
    abortSignal: request.signal,
  })

  return createUIMessageStreamResponse({
    headers: { "Cache-Control": "no-store" },
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: "ask", size: 16 }),
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
