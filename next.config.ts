import type { NextConfig } from "next";
import os from "os";

function getAllowedDevOrigins(): string[] {
  const origins = new Set<string>([
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "host.docker.internal",
    "host.docker.internal:3000",
  ]);

  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name] || []) {
        if (net.family === "IPv4" && !net.internal) {
          const ip = net.address;
          origins.add(ip);
          origins.add(`${ip}:3000`);
          origins.add(`${ip}:443`);
          origins.add(`${ip}:80`);
          origins.add(`http://${ip}`);
          origins.add(`https://${ip}`);
          origins.add(`http://${ip}:3000`);
          origins.add(`https://${ip}:3000`);

          // Automatically include the entire local /24 subnet range (1..254)
          const prefix = ip.substring(0, ip.lastIndexOf("."));
          for (let i = 1; i <= 254; i++) {
            const subnetIp = `${prefix}.${i}`;
            origins.add(subnetIp);
            origins.add(`${subnetIp}:3000`);
          }
        }
      }
    }
  } catch {
    // Fallback if OS inspection is unavailable
  }

  return Array.from(origins);
}

const nextConfig: NextConfig = {
<<<<<<< HEAD
  allowedDevOrigins: getAllowedDevOrigins(),
=======
  allowedDevOrigins: [
    "172.16.20.176",
    "192.168.234.68",
    "192.168.1.215",
    "192.168.*.*",
    "172.16.*.*",
  ],
>>>>>>> efbee49bc3f54c9973babd1c2ea523f48633f048
  devIndicators: false,
};

export default nextConfig;
