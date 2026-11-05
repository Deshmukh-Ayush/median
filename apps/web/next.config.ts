import bundleAnalyzer from "@next/bundle-analyzer"
import type { NextConfig } from "next"

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
})

const nextConfig: NextConfig = {
  transpilePackages: [
    "@workspace/ui",
    "@workspace/ledger",
    "@workspace/contracts",
  ],
  // Heavy, server-only libraries: keep them out of the server bundle and load
  // them from node_modules at runtime. Never import them in client components.
  serverExternalPackages: ["@react-pdf/renderer"],
  poweredByHeader: false,
  reactStrictMode: true,
}

export default withBundleAnalyzer(nextConfig)
