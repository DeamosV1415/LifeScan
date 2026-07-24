import Link from "next/link";

/**
 * Shared UI primitives so all seven surfaces read as one system. Kept
 * deliberately small — a wordmark, the eyebrow label, the live pill, and the
 * page shell. Everything else is CSS utility classes in globals.css.
 */

/** The + badge + LIFESCAN wordmark. Links home unless `plain` is set. */
export function Wordmark({
  size = "md",
  href = "/",
  plain = false,
}: {
  size?: "sm" | "md";
  href?: string;
  plain?: boolean;
}) {
  const badge = size === "sm" ? "size-6" : "size-7";
  const label = size === "sm" ? "text-base" : "text-lg";
  const inner = (
    <span className="flex items-center gap-2">
      <span
        className={`grid ${badge} place-items-center rounded-md shadow-sm`}
        style={{
          background: "radial-gradient(125% 125% at 30% 18%, #16344c 0%, #0b1220 62%)",
          border: "1px solid rgba(45, 212, 167, 0.28)",
        }}
      >
        {/* Break-glass facet: a cut crystal fractured along a heartbeat — the
            product's headline mechanic, in an "ink gem" jewel setting. */}
        <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className="size-[72%]">
          <defs>
            <linearGradient id="ls-facet" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#6ff2cd" />
              <stop offset="0.5" stopColor="#2dd4a7" />
              <stop offset="1" stopColor="#0f9c78" />
            </linearGradient>
          </defs>
          <path
            d="M32 5 L49 18 L44 43 L32 59 L20 43 L15 18 Z"
            stroke="url(#ls-facet)"
            strokeWidth="4.2"
            strokeLinejoin="round"
          />
          <path
            d="M16 32 L24 32 L27 23 L33 41 L36 32 L48 32"
            stroke="url(#ls-facet)"
            strokeWidth="4.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className={`font-display font-medium tracking-tight text-text ${label}`}>LifeScan</span>
    </span>
  );
  if (plain) return inner;
  return (
    <Link href={href} className="inline-flex transition-opacity hover:opacity-80">
      {inner}
    </Link>
  );
}

export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`eyebrow ${className}`}>{children}</p>;
}

/** Small amber pill marking the seeded demo patient wherever their card shows. */
export function DemoTag() {
  return (
    <span
      className="chip shrink-0"
      style={{
        background: "color-mix(in srgb, var(--caution) 16%, transparent)",
        color: "var(--caution)",
      }}
    >
      Demo
    </span>
  );
}

/** Live/connection pill with a pulsing dot. */
export function LivePill({ live, label }: { live: boolean; label?: string }) {
  return (
    <span className={`chip ${live ? "chip-vital" : "chip-muted"}`}>
      <span
        className={`size-1.5 rounded-full ${live ? "bg-vital live-dot" : "bg-faint"}`}
        style={live ? {} : { background: "var(--faint)" }}
      />
      {label ?? (live ? "Live" : "Connecting…")}
    </span>
  );
}

/** Standard page container. `width` picks the mobile app column vs. a console. */
export function PageShell({
  children,
  width = "app",
  className = "",
}: {
  children: React.ReactNode;
  width?: "app" | "console";
  className?: string;
}) {
  const max = width === "console" ? "max-w-3xl" : "max-w-md";
  return (
    <main className={`mx-auto min-h-dvh w-full ${max} px-5 py-10 sm:px-6 ${className}`}>
      {children}
    </main>
  );
}
