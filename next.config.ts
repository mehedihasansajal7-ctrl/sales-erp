import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/Node-only libraries must not be bundled by Turbopack.
  serverExternalPackages: ["exceljs", "pdfkit", "@prisma/client", "bcryptjs"],
  /**
   * Dev-mode only: Next protects its dev resources from cross-origin requests.
   * These hosts must be allowed so the app can be opened as `127.0.0.1`, from
   * another device on the office LAN (phone/tablet testing) or by Playwright.
   */
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.*", "10.*"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
