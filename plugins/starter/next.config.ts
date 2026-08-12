import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  output: "standalone",

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            // The page is rendered inside the merchant's dashboard, so it must
            // permit that origin to frame it. Without this the browser blocks
            // the embed and the handshake never happens.
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' http://localhost:* http://*.localhost:* https://localhost:* https://*.localhost:* https://*.orbitcommerce.net https://*.myorbitcommerce.net",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
