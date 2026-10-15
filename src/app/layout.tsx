import type { Metadata, Viewport } from "next";
import { ToastHost } from "@/components/ui/tabs";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Sales & Delivery ERP",
    template: "%s · Sales & Delivery ERP",
  },
  description:
    "Integrated sales, order, inventory and delivery management for bulk commodity trading (MT / BDT).",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#059669",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Noto Sans Bengali so Bangla names render correctly. It loads with a
          local font-stack fallback (Nirmala UI on Windows, Noto on Android/Linux),
          so the app renders correctly without internet access and the build never
          depends on the font being reachable.

          The `no-page-custom-font` rule targets the Pages Router `_document`; in
          the App Router the root layout is the correct place for this tag.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="min-h-dvh antialiased">
        {children}
        <ToastHost />
      </body>
    </html>
  );
}
