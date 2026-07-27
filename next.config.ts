import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["172.16.20.176", "192.168.234.68"],
  devIndicators: false,
};

export default nextConfig;
