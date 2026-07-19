import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistrar } from "./sw-registrar";

export const metadata: Metadata = {
  title: "LifeScan — Emergency Medical ID",
  description:
    "Instant emergency medical identity. Works offline, on any phone, with on-chain accountability for every access.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "LifeScan",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#080d18",
  width: "device-width",
  initialScale: 1,
  // Emergency responders may need to zoom. Never disable it.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
