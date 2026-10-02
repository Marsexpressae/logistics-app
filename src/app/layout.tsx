import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/layout/AppShell";
import PwaSetup from "@/components/pwa/PwaSetup";
import { site } from "@/config/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: site.name, template: `%s | ${site.name}` },
  description: site.description,
  applicationName: site.name,
  // iOS: "Add to Home Screen" opens full-screen with this title and icon.
  appleWebApp: { capable: true, title: site.name, statusBarStyle: "default" },
  icons: {
    // Browser tab: the SVG where supported, with a PNG fallback.
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/192", type: "image/png", sizes: "192x192" },
    ],
    apple: "/icons/180",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  viewportFit: "cover", // lets safe-area insets (home bar, notch) apply on phones
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-full flex-col bg-slate-50 text-slate-900">
        <AppShell>{children}</AppShell>
        <PwaSetup />
      </body>
    </html>
  );
}
