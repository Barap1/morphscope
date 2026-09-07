import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ["@morphscope/ui"],
  images: {
    qualities: [68],
  },
};

export default nextConfig;
