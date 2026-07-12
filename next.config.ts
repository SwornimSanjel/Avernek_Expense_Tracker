import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Supabase Storage public bucket for receipt images
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
