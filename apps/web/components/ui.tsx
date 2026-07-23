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
  const badge = size === "sm" ? "size-6 text-xs" : "size-7 text-sm";
  const label = size === "sm" ? "text-xs" : "text-sm";
  const inner = (
    <span className="flex items-center gap-2">
      <span
        className={`grid ${badge} place-items-center rounded-md font-black text-white shadow-sm`}
        style={{
          background: "linear-gradient(160deg, #ff6b7a 0%, var(--brand) 55%, #d43a4d 100%)",
        }}
      >
        +
      </span>
      <span className={`font-display font-bold tracking-[0.22em] text-text uppercase ${label}`}>
        LifeScan
      </span>
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
