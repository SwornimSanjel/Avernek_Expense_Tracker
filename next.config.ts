import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep development and production artifacts separate. Sharing `.next`
  // caused local CSS/JS 404s after running a production build.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  images: {
    remotePatterns: [
      // Supabase Storage public bucket for receipt images
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
