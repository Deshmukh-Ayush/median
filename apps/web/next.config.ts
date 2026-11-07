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
  // The PDF font files are read from disk at runtime, not imported.
  outputFileTracingIncludes: {
    "/invoices/**": ["./src/server/pdf/fonts/*.ttf"],
  },
  poweredByHeader: false,
  experimental: {
    // Settlement reports and bank statements are uploaded through server
    // actions; the import form caps files at 4 MB.
    serverActions: { bodySizeLimit: "5mb" },
  },
  reactStrictMode: true,
}

export default withBundleAnalyzer(nextConfig)
