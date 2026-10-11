import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql"],
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
