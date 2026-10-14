import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep development and production artifacts separate. Sharing `.next`
  // caused local CSS/JS 404s after running a production build.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  // The Docker image runs Next's self-contained server bundle. Gated on
  // DOCKER_BUILD so Netlify's Next.js plugin keeps seeing the default output.
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,
  experimental: {
    // Forms can carry up to 40 MB of bills / agreement pages
    // (lib/attachments.ts) plus the other fields. The 1 MB default would
    // reject a single phone photo of a receipt.
    serverActions: { bodySizeLimit: "45mb" },
  },
  images: {
    remotePatterns: [
      // Supabase Storage public bucket for receipt images
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
