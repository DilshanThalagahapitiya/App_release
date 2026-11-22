import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import { NoZoom } from "@/components/no-zoom";

export const metadata: Metadata = { title: { default: "Crede App Release Portal", template: "%s · Crede App Release Portal" }, description: "Self-hosted iOS build distribution and QA feedback.", appleWebApp: { capable: true, title: "Crede Releases", statusBarStyle: "default" }, formatDetection: { telephone: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, minimumScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ffffff" }, { media: "(prefers-color-scheme: dark)", color: "#161a22" }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body><NoZoom /><Providers>{children}</Providers></body>
    </html>
  );
}
