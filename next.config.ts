import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    qualities: [75, 95],
  },
  // Next.js 16 caps proxy-readable request bodies at 10MB by default.
  // Relic ZIP uploads are validated server-side at 200MB (see
  // /api/relics/draft route MAX_ARCHIVE_BYTES) — keep this in step so
  // large vault archives reach the handler instead of being truncated
  // and 400'd by the proxy before our auth/CSRF checks even run.
  experimental: {
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
