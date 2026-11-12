"use client"

import { Chat, useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import type { UIMessage } from "ai"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import {
  ArrowUpIcon,
  CircleAlertIcon,
  CheckIcon,
  FileTextIcon,
  SquareIcon,
} from "lucide-react"

import { Bubble, BubbleContent } from "@workspace/ui/components/bubble"
import { Button } from "@workspace/ui/components/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@workspace/ui/components/input-group"
import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@workspace/ui/components/marker"
import { Message, MessageContent } from "@workspace/ui/components/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@workspace/ui/components/trace"

import type { AskPageContext } from "@/lib/ask-context"
import { askSources, askSteps, askText } from "@/lib/ask-parts"

import { AnswerText } from "./answer-text"
import { ProposalCards } from "./proposal-card"

export const ASK_SUGGESTIONS = [
  "How much money came in last month?",
  "Who owes me the most right now?",
  "What's my cash balance today?",
  "How much GST is due for last month?",
  "What's my net profit this financial year?",
  "Which bills are waiting in the AI inbox?",
] as const

export interface AskChatProps {
  readonly conversationId: string
  readonly initialMessages?: readonly UIMessage[]
  /** The page the user is on (the sheet); none on /ask itself. */
  readonly pageContext?: AskPageContext | undefined
  readonly suggestions?: readonly string[]
  /** After each answer: e.g. refresh the conversation list. */
  readonly onAnswered?: (() => void) | undefined
  /** Before the first question is sent. */
  readonly onStart?: (() => void) | undefined
}

function Steps({ message }: { message: UIMessage }) {
  const steps = askSteps(message)
  if (steps.length === 0) return null
  return (
    <Trace>
      {steps.map((step) => (
        <TraceLine
          key={step.id}
          {...(step.status === "running"
            ? { status: "running" as const }
            : step.status === "error"
              ? { status: "error" as const }
              : {})}
        >
          <TraceIcon>
            {step.status === "running" ? (
              <Spinner />
            ) : step.status === "error" ? (
              <CircleAlertIcon />
            ) : (
              <CheckIcon />
            )}
          </TraceIcon>
          <TraceTitle>{step.label}</TraceTitle>
        </TraceLine>
      ))}
    </Trace>
  )
}

function Sources({ message }: { message: UIMessage }) {
  const sources = askSources(message)
  if (sources.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5 border-t border-subtle pt-3">
      <p className="text-xs font-medium text-fg-secondary">Sources</p>
      {sources.map((source) => (
        <Marker key={source.href} className="text-xs">
          <MarkerIcon>
            <FileTextIcon />
          </MarkerIcon>
          <MarkerContent>
            <Link href={source.href}>{source.title}</Link>
          </MarkerContent>
        </Marker>
      ))}
    </div>
  )
}

function Answer({ message }: { message: UIMessage }) {
  const text = askText(message)
  return (
    <Message>
      <MessageContent>
        <Steps message={message} />
        <ProposalCards message={message} />
        {text ? (
          <Bubble variant="ghost">
            <BubbleContent>
              <AnswerText text={text} />
            </BubbleContent>
          </Bubble>
        ) : null}
        <Sources message={message} />
      </MessageContent>
    </Message>
  )
}

function Question({ message }: { message: UIMessage }) {
  return (
    <Message align="end">
      <MessageContent>
        <Bubble>
          <BubbleContent className="whitespace-pre-wrap">
            {askText(message)}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

// Only the new question goes up; the server keeps the history.
const transport = new DefaultChatTransport({
  api: "/api/ask",
  prepareSendMessagesRequest: ({ id, messages, body }) => ({
    body: { ...body, conversationId: id, message: messages.at(-1) },
  }),
})

/**
 * One Chat per conversation for the life of the tab, so closing the sheet,
 * changing page or opening the same conversation on /ask keeps its messages
 * (and an answer still streaming).
 */
const chats = new Map<string, Chat<UIMessage>>()
function chatFor(id: string, initialMessages: readonly UIMessage[]) {
  let chat = chats.get(id)
  if (!chat) {
    chat = new Chat({ id, messages: [...initialMessages], transport })
    chats.set(id, chat)
  }
  return chat
}

/**
 * Ask Median's chat: questions, the steps taken to answer, the answer and
 * its sources. Used by /ask and the top-bar sheet; both talk to /api/ask.
 */
export function AskChat({
  conversationId,
  initialMessages = [],
  pageContext,
  suggestions = ASK_SUGGESTIONS,
  onAnswered,
  onStart,
}: AskChatProps) {
  const [chat] = useState(() => chatFor(conversationId, initialMessages))
  const { messages, sendMessage, status, stop, error, regenerate } = useChat({
    chat,
  })
  const [input, setInput] = useState("")
  const busy = status === "submitted" || status === "streaming"

  // An answer finished: busy → ready.
  const wasBusy = useRef(busy)
  useEffect(() => {
    if (wasBusy.current && status === "ready") onAnswered?.()
    wasBusy.current = busy
  }, [busy, status, onAnswered])

  // Sent with each request, so the sheet always sends the page it's open on.
  const requestOptions = { body: pageContext ? { pageContext } : {} }

  const send = (text: string) => {
    const question = text.trim()
    if (!question || busy) return
    if (messages.length === 0) onStart?.()
    void sendMessage({ text: question }, requestOptions)
    setInput("")
  }

  const last = messages.at(-1)
  // Nothing visibly moving (before the first tool, or the model thinking
  // between steps): show a spinner so the wait feels alive.
  const waiting =
    status === "submitted" ||
    (busy &&
      (last?.role === "user" ||
        (last !== undefined &&
          askText(last) === "" &&
          !askSteps(last).some((s) => s.status === "running"))))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col justify-end gap-3 px-4 pb-4">
          <p className="text-sm text-fg-secondary">
            Ask about your books. Answers come from your ledger, with a link to
            each figure.
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <Bubble key={s} variant="outline" className="max-w-full">
                <BubbleContent
                  render={<button type="button" />}
                  onClick={() => send(s)}
                >
                  {s}
                </BubbleContent>
              </Bubble>
            ))}
          </div>
        </div>
      ) : (
        <MessageScrollerProvider>
          <MessageScroller className="flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="px-4 py-4">
                {messages.map((message, i) => (
                  <MessageScrollerItem
                    key={message.id}
                    scrollAnchor={i === messages.length - 1}
                  >
                    {message.role === "user" ? (
                      <Question message={message} />
                    ) : (
                      <Answer message={message} />
                    )}
                  </MessageScrollerItem>
                ))}
                {waiting ? (
                  <MessageScrollerItem>
                    <Trace>
                      <TraceLine status="running">
                        <TraceIcon>
                          <Spinner />
                        </TraceIcon>
                        <TraceTitle>Reading your books…</TraceTitle>
                      </TraceLine>
                    </Trace>
                  </MessageScrollerItem>
                ) : null}
                {error ? (
                  <MessageScrollerItem>
                    <Message>
                      <MessageContent>
                        <Bubble variant="destructive">
                          <BubbleContent>
                            Couldn&apos;t answer that.{" "}
                            {error.message.startsWith("{")
                              ? "Try again in a moment."
                              : error.message}
                          </BubbleContent>
                        </Bubble>
                        <div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void regenerate(requestOptions)}
                          >
                            Try again
                          </Button>
                        </div>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                ) : null}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      )}

      <form
        className="shrink-0 border-t border-subtle p-3"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <InputGroup>
          <InputGroupTextarea
            aria-label="Ask a question about your books"
            placeholder="Ask about your books…"
            className="max-h-40 min-h-10"
            value={input}
            maxLength={2000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault()
                send(input)
              }
            }}
          />
          <InputGroupAddon align="block-end" className="justify-end">
            {busy ? (
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                aria-label="Stop"
                onClick={() => void stop()}
              >
                <SquareIcon />
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                size="icon-sm"
                aria-label="Send"
                disabled={input.trim() === ""}
              >
                <ArrowUpIcon />
              </Button>
            )}
          </InputGroupAddon>
        </InputGroup>
        <p className="mt-2 text-2xs text-fg-tertiary">
          Read-only. Ask Median can be wrong; check the linked source.
        </p>
      </form>
    </div>
  )
}
