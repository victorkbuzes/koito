import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "172.16.20.176",
    "192.168.234.68",
    "192.168.1.215",
    "192.168.*.*",
    "172.16.*.*",
  ],
  devIndicators: false,
};

export default nextConfig;
