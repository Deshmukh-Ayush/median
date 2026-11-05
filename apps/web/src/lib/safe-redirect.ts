/**
 * Returns `value` if it is a same-site path ("/invoices?x=1"), else the
 * fallback. Stops open redirects through ?redirectTo=https://evil.example.
 */
export function safeRedirect(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback
  if (!value.startsWith("/") || value.startsWith("//")) return fallback
  if (value.includes("\\") || hasControlCharacter(value)) return fallback
  return value
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}
