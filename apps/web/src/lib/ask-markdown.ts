/**
 * The small slice of markdown Ask Median answers use: paragraphs, bullet and
 * numbered lists, **bold** and [links](/path). Parsed to a tree that React
 * renders as text nodes, so nothing the model writes becomes HTML.
 *
 * Links render only when they point inside the app ("/reports?…"); anything
 * else (https:, javascript:, //host) stays as plain text. Citations always
 * point at app pages, so this loses nothing and can't send anyone off-site.
 */

export type AskInline =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "strong"; readonly children: readonly AskInline[] }
  | {
      readonly type: "link"
      readonly href: string
      readonly children: readonly AskInline[]
    }

export type AskBlock =
  | { readonly type: "paragraph"; readonly children: readonly AskInline[] }
  | {
      readonly type: "list"
      readonly ordered: boolean
      readonly items: readonly (readonly AskInline[])[]
    }

/** An in-app path: one leading slash, no scheme, no protocol-relative host. */
export function isAppHref(href: string): boolean {
  return /^\/(?!\/)[^\s\\]*$/.test(href)
}

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g

export function parseInline(text: string): AskInline[] {
  const out: AskInline[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index
    if (index > last) out.push({ type: "text", text: text.slice(last, index) })
    const [whole, bold, label, href] = match
    if (bold !== undefined) {
      out.push({ type: "strong", children: parseInline(bold) })
    } else if (label !== undefined && href !== undefined && isAppHref(href)) {
      out.push({ type: "link", href, children: parseInline(label) })
    } else {
      out.push({ type: "text", text: label ?? whole })
    }
    last = index + whole.length
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) })
  return out
}

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const HEADING = /^\s*#{1,6}\s+(.*)$/

export function parseAskMarkdown(source: string): AskBlock[] {
  const blocks: AskBlock[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: AskInline[][] } | null = null

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({
        type: "paragraph",
        children: parseInline(paragraph.join(" ")),
      })
      paragraph = []
    }
  }
  const flushList = () => {
    if (list) {
      blocks.push({ type: "list", ...list })
      list = null
    }
  }

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    const item = bullet ?? numbered
    if (item) {
      flushParagraph()
      const ordered = numbered !== null
      if (list && list.ordered !== ordered) flushList()
      list ??= { ordered, items: [] }
      list.items.push(parseInline(item[1] ?? ""))
      continue
    }
    if (line.trim() === "") {
      flushParagraph()
      flushList()
      continue
    }
    flushList()
    const heading = HEADING.exec(line)
    if (heading) {
      flushParagraph()
      blocks.push({
        type: "paragraph",
        children: [{ type: "strong", children: parseInline(heading[1] ?? "") }],
      })
      continue
    }
    paragraph.push(line.trim())
  }
  flushParagraph()
  flushList()
  return blocks
}
