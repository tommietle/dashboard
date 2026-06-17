import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sta localtunnel-hosts toe zodat de dev-bundle laadt via de publieke URL.
  allowedDevOrigins: ['*.loca.lt'],
};

export default nextConfig;
