import "server-only"

import { idSchema } from "@workspace/contracts"
import type { IsoDate } from "@workspace/contracts"
import { convertToModelMessages, isStepCount, streamText } from "ai"
import type { UIMessage } from "ai"
import { z } from "zod"

import { askPageContextSchema } from "@/lib/ask-context"
import type { AskPageContext } from "@/lib/ask-context"

import { getAskModel } from "../models"
import type { OrgContext } from "@/server/services"

import { askInstructions } from "./instructions"
import { createAskTools } from "./tools"

/** Most tool rounds per question: enough to look up, then drill down. */
const MAX_STEPS = 8

const MAX_QUESTION_LENGTH = 2000

/**
 * Fail instead of spinning: a provider that stops answering (the free tier
 * under load) ends the request with an error the user can retry. Under the
 * route's 60 s maxDuration.
 */
const TIMEOUT = { totalMs: 55_000, firstChunkMs: 25_000, toolMs: 15_000 }

/**
 * The body POST /api/ask accepts. The client sends only the new question;
 * history comes from the server's own store, so a client can't put words in
 * the assistant's mouth or forge tool results.
 */
export const askRequestSchema = z.object({
  conversationId: idSchema,
  message: z.object({
    id: z.string().min(1).max(100),
    role: z.literal("user"),
    parts: z
      .array(
        z.object({
          type: z.literal("text"),
          text: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
        })
      )
      .length(1),
  }),
  pageContext: askPageContextSchema.optional(),
})

export type AskRequest = z.infer<typeof askRequestSchema>

export interface AskInput {
  /** The whole conversation so far, ending with the new question. */
  readonly messages: readonly UIMessage[]
  readonly pageContext?: AskPageContext | undefined
  readonly today: IsoDate
  readonly abortSignal?: AbortSignal | undefined
}

/**
 * Answers the last question in `messages` from the books, streaming. The
 * model sees only the read-only tools bound to `ctx`; every figure it can
 * quote comes from a service.
 */
export async function ask(ctx: OrgContext, input: AskInput) {
  const tools = createAskTools(ctx)
  return streamText({
    model: getAskModel(),
    instructions: askInstructions({
      today: input.today,
      role: ctx.role,
      pageContext: input.pageContext,
    }),
    messages: await convertToModelMessages([...input.messages], { tools }),
    tools,
    stopWhen: isStepCount(MAX_STEPS),
    temperature: 0,
    timeout: TIMEOUT,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })
}
