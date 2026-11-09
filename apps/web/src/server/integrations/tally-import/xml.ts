// A small XML reader for Tally exports: elements, attributes, text, CDATA,
// comments, processing instructions and character references. No DTDs or
// namespaces (Tally's are kept as plain attribute names). Malformed input
// throws XmlError with the offset.

export interface XmlElement {
  readonly name: string
  readonly attrs: Readonly<Record<string, string>>
  readonly children: readonly XmlElement[]
  /** Concatenated text directly inside this element, trimmed. */
  readonly text: string
}

export class XmlError extends Error {
  override readonly name = "XmlError"
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

// Tally writes control characters such as &#4; that XML 1.0 forbids; they're
// dropped rather than rejected.
function decode(raw: string, at: number): string {
  return raw.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g,
    (_, ref: string) => {
      if (ref.startsWith("#")) {
        const code =
          ref[1] === "x"
            ? parseInt(ref.slice(2), 16)
            : parseInt(ref.slice(1), 10)
        if (code < 0x20 && code !== 0x9 && code !== 0xa && code !== 0xd)
          return ""
        return String.fromCodePoint(code)
      }
      const value = ENTITIES[ref]
      if (value === undefined)
        throw new XmlError(`Unknown entity &${ref}; near ${at}`)
      return value
    }
  )
}

interface Open {
  name: string
  attrs: Record<string, string>
  children: XmlElement[]
  text: string[]
}

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y
const ATTR = /\s+([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/y

/** Parses a document and returns its root element. */
export function parseXml(input: string): XmlElement {
  const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const stack: Open[] = []
  let root: XmlElement | null = null
  let i = 0
  const close = (open: Open): XmlElement => ({
    name: open.name,
    attrs: open.attrs,
    children: open.children,
    text: open.text.join("").trim(),
  })
  const attach = (el: XmlElement) => {
    const parent = stack.at(-1)
    if (parent) parent.children.push(el)
    else if (root)
      throw new XmlError(`Second root element <${el.name}> at ${i}`)
    else root = el
  }

  while (i < src.length) {
    const lt = src.indexOf("<", i)
    const textEnd = lt < 0 ? src.length : lt
    if (textEnd > i) {
      const text = src.slice(i, textEnd)
      const parent = stack.at(-1)
      if (parent) parent.text.push(decode(text, i))
      else if (text.trim())
        throw new XmlError(`Text outside the root element at ${i}`)
    }
    if (lt < 0) break
    i = lt
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4)
      if (end < 0) throw new XmlError(`Unclosed comment at ${i}`)
      i = end + 3
    } else if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9)
      if (end < 0) throw new XmlError(`Unclosed CDATA at ${i}`)
      stack.at(-1)?.text.push(src.slice(i + 9, end))
      i = end + 3
    } else if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i + 2)
      if (end < 0) throw new XmlError(`Unclosed processing instruction at ${i}`)
      i = end + 2
    } else if (src.startsWith("<!", i)) {
      const end = src.indexOf(">", i + 2)
      if (end < 0) throw new XmlError(`Unclosed declaration at ${i}`)
      i = end + 1
    } else if (src[i + 1] === "/") {
      NAME.lastIndex = i + 2
      const m = NAME.exec(src)
      const open = stack.pop()
      if (!m || !open || open.name !== m[0])
        throw new XmlError(`Mismatched closing tag at ${i}`)
      const gt = src.indexOf(">", NAME.lastIndex)
      if (gt < 0 || src.slice(NAME.lastIndex, gt).trim())
        throw new XmlError(`Bad closing tag at ${i}`)
      attach(close(open))
      i = gt + 1
    } else {
      NAME.lastIndex = i + 1
      const m = NAME.exec(src)
      if (!m) throw new XmlError(`Bad tag at ${i}`)
      const attrs: Record<string, string> = {}
      let j = NAME.lastIndex
      for (;;) {
        ATTR.lastIndex = j
        const a = ATTR.exec(src)
        if (!a) break
        attrs[a[1] ?? ""] = decode(a[3] ?? a[4] ?? "", j)
        j = ATTR.lastIndex
      }
      while (
        src[j] === " " ||
        src[j] === "\n" ||
        src[j] === "\r" ||
        src[j] === "\t"
      )
        j++
      if (src.startsWith("/>", j)) {
        attach({ name: m[0], attrs, children: [], text: "" })
        i = j + 2
      } else if (src[j] === ">") {
        stack.push({ name: m[0], attrs, children: [], text: [] })
        i = j + 1
      } else {
        throw new XmlError(`Bad tag <${m[0]}> at ${i}`)
      }
    }
  }
  if (stack.length > 0) throw new XmlError(`Unclosed <${stack.at(-1)?.name}>`)
  if (!root) throw new XmlError("No root element")
  return root
}

/** Direct children named `name`. */
export const childrenNamed = (el: XmlElement, name: string) =>
  el.children.filter((c) => c.name === name)

/** Text of the first direct child named `name`, or "". */
export const childText = (el: XmlElement, name: string) =>
  el.children.find((c) => c.name === name)?.text ?? ""

/** Every descendant (depth-first) named `name`. */
export function descendants(el: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = []
  const walk = (e: XmlElement) => {
    for (const c of e.children) {
      if (c.name === name) out.push(c)
      else walk(c)
    }
  }
  walk(el)
  return out
}

/** Escapes text or an attribute value for XML output. */
export function escapeXml(value: string): string {
  // XML 1.0 can't carry control characters other than tab, LF and CR.
  const clean = [...value]
    .filter((ch) => {
      const c = ch.charCodeAt(0)
      return c >= 0x20 || c === 0x9 || c === 0xa || c === 0xd
    })
    .join("")
  return clean
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
