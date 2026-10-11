import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql"],
  outputFileTracingRoot: process.cwd(),
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
