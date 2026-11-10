import os from "os"

function allowedDevOrigins() {
  const hosts = new Set(["82.38.4.5"])
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if ((entry.family === "IPv4" || entry.family === 4) && entry.address) {
        hosts.add(entry.address)
      }
    }
  }
  return [...hosts]
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: allowedDevOrigins(),
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
