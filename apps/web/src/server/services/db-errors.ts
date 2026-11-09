/** True for a Postgres unique violation (23505), however Drizzle wraps it. */
export function isUniqueViolation(error: unknown): boolean {
  let e: unknown = error
  // Drizzle wraps driver errors; the Postgres error is on `cause`.
  for (let i = 0; i < 3 && typeof e === "object" && e !== null; i++) {
    if ("code" in e && e.code === "23505") return true
    e = "cause" in e ? e.cause : undefined
  }
  return false
}
