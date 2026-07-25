/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // The service worker must not be cached by the CDN, or a stale worker
        // will keep serving an old app shell after a deploy.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // Baseline security headers on every response. A strict Content-Security-
        // Policy is deliberately OMITTED: Privy serves the embedded-wallet key in
        // a cross-origin iframe and the app makes RPC + SSE calls to several
        // hosts, so a correct CSP is a separate, tested task — a wrong one would
        // silently break login or break-glass mid-demo. The headers below are all
        // safe with those flows.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Turn off device APIs the app never uses (clipboard is left enabled —
          // the copy buttons need it). NFC tags are read by the OS opening a URL,
          // not via the Web NFC API, so no permission is required for the scan.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
