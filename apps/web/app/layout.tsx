import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistrar } from "./sw-registrar";
import { DevWarningFilter } from "./dev-warning-filter";
import { Providers } from "./providers";

// Type system: Space Grotesk = display / headings / big numbers,
// Inter = body & UI, JetBrains Mono = addresses / IDs / the agent trace.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const spaceGrotesk = Space_Grotesk({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-space",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LifeScan — Emergency Medical ID",
  description:
    "Instant emergency medical identity. Works offline, on any phone, with on-chain accountability for every access.",
  manifest: "/manifest.json",
  // The tab favicon: browsers do NOT use the manifest icons for the tab, so it
  // must be declared here explicitly. SVG favicon — supported in every modern
  // browser (Chrome/Edge/Firefox/Safari).
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg" }],
  },
  appleWebApp: {
    capable: true,
    title: "LifeScan",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#090d16",
  width: "device-width",
  initialScale: 1,
  // Emergency responders may need to zoom. Never disable it.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
    >
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          data-gr-* attributes onto <body> before React hydrates, which would
          otherwise trip a hydration mismatch we can't control. */}
      <body className="font-sans antialiased" suppressHydrationWarning>
        <DevWarningFilter />
        <ServiceWorkerRegistrar />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
