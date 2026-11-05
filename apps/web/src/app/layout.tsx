import type { Metadata } from "next"
import { Inter } from "next/font/google"

import "@workspace/ui/globals.css"

// Inter with its optical-size axis: text sizes get Inter's text cut, and
// `font-display` (opsz 32) gives Inter Display for page titles. One file.
const inter = Inter({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-inter",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Median",
  description: "AI-native revenue and ledger platform for Indian businesses.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en-IN" className={inter.variable}>
      <body className="font-sans">{children}</body>
    </html>
  )
}
