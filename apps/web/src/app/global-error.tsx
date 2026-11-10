"use client"

/**
 * Last resort when the root layout itself fails. It renders its own
 * document without the app's styles, so it uses inline styles only.
 */
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en-IN">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100svh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          margin: 0,
          padding: 16,
          textAlign: "center",
        }}
      >
        <title>Something went wrong · Median</title>
        <h1 style={{ fontSize: 18, margin: 0 }}>Median didn&apos;t load</h1>
        <p style={{ margin: 0, opacity: 0.7 }}>
          Nothing in your books was changed. Try again in a moment.
        </p>
        <button
          type="button"
          onClick={() => retry()}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid currentColor",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
