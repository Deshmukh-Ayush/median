import Link from "next/link"
import { Fragment } from "react"

import { parseAskMarkdown } from "@/lib/ask-markdown"
import type { AskInline } from "@/lib/ask-markdown"

function Inline({ nodes }: { nodes: readonly AskInline[] }) {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return <Fragment key={i}>{node.text}</Fragment>
      case "strong":
        return (
          <strong key={i} className="font-semibold">
            <Inline nodes={node.children} />
          </strong>
        )
      case "link":
        return (
          <Link
            key={i}
            href={node.href}
            className="text-fg underline decoration-default underline-offset-3 hover:decoration-current"
          >
            <Inline nodes={node.children} />
          </Link>
        )
    }
  })
}

/** An answer's text: paragraphs, lists, bold and in-app links only. */
export function AnswerText({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2">
      {parseAskMarkdown(text).map((block, i) =>
        block.type === "paragraph" ? (
          <p key={i}>
            <Inline nodes={block.children} />
          </p>
        ) : block.ordered ? (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {block.items.map((item, j) => (
              <li key={j}>
                <Inline nodes={item} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {block.items.map((item, j) => (
              <li key={j}>
                <Inline nodes={item} />
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
