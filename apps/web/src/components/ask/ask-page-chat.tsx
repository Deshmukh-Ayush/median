"use client"

import type { UIMessage } from "ai"
import { useRouter } from "next/navigation"

import { AskChat } from "./ask-chat"

/**
 * /ask's chat. A new conversation takes its id into the URL on the first
 * question (so a reload keeps it), and the list refreshes after each answer.
 */
export function AskPageChat({
  conversationId,
  initialMessages,
}: {
  conversationId: string
  initialMessages: readonly UIMessage[]
}) {
  const router = useRouter()
  return (
    <AskChat
      key={conversationId}
      conversationId={conversationId}
      initialMessages={initialMessages}
      onStart={() => {
        window.history.replaceState(null, "", `/ask?c=${conversationId}`)
      }}
      onAnswered={() => router.refresh()}
    />
  )
}
