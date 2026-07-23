import Link from "next/link";
import { buildTier0 } from "@/lib/tier0";
import { Wordmark, Eyebrow } from "@/components/ui";

/**
 * Landing page. Doubles as the install surface: the demo phone visits this
 * once, installs the PWA, and from then on NFC taps open offline.
 */

const DEMO_FRAGMENT = buildTier0({
  name: "Ramesh Kumar",
  bloodGroup: "O+",
  allergies: ["Penicillin", "Sulfa"],
  flags: ["PACEMAKER", "ANTICOAGULANT"],
  emergencyContact: "+91 98765 43210",
});

const CONSOLES: { href: string; role: string; label: string; dot: string }[] = [
  { href: "/patient", role: "Patient", label: "Issue a card", dot: "var(--vital)" },
  { href: "/patient/audit", role: "Patient", label: "Access log", dot: "var(--info)" },
  { href: "/provider/break-glass", role: "Provider", label: "Break glass", dot: "var(--danger)" },
  { href: "/er", role: "ER", label: "Incoming board", dot: "var(--caution)" },
];

export default function Home() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-5 py-10 sm:px-6">
      <Wordmark />

      <h1 className="mt-9 text-[2rem] leading-[1.12] font-bold text-balance text-text rise">
        Emergency medical identity that works when nothing else does.
      </h1>
      <p className="mt-4 text-[0.95rem] leading-relaxed text-muted rise" style={{ animationDelay: "60ms" }}>
        Tap the card. Blood group, allergies and implants appear in under a
        second — with no signal, no app store and no account. The full clinical
        record stays encrypted until a registered clinician breaks glass, and
        every access is permanently logged on-chain.
      </p>

      <div className="mt-8 space-y-3 rise" style={{ animationDelay: "120ms" }}>
        <Link
          href={`/s/preview#${DEMO_FRAGMENT}`}
          className="card group flex items-center justify-between gap-4 px-5 py-4 transition hover:border-line-strong"
          style={{ borderColor: "color-mix(in srgb, var(--vital) 35%, transparent)" }}
        >
          <span>
            <span className="block text-base font-semibold text-vital">Open a demo card</span>
            <span className="mt-0.5 block text-xs text-muted">
              Exactly what a paramedic sees on scan
            </span>
          </span>
          <span className="text-vital transition-transform group-hover:translate-x-0.5">→</span>
        </Link>

        <div className="card-quiet px-5 py-4">
          <p className="text-sm font-semibold text-text">Install for offline use</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Browser menu → <strong className="text-text">Install app</strong> or{" "}
            <strong className="text-text">Add to Home screen</strong>. Open it once
            while online. After that, card taps work in airplane mode.
          </p>
        </div>
      </div>

      <section className="mt-10 rise" style={{ animationDelay: "180ms" }}>
        <Eyebrow>Three layers of redundancy</Eyebrow>
        <ul className="mt-3 space-y-2.5">
          {[
            ["Printed", "readable with no device at all"],
            ["QR code", "any camera phone, no app"],
            ["NFC tap", "one tap, the fastest path"],
          ].map(([title, desc], i) => (
            <li key={title} className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] text-faint tnum">{`0${i + 1}`}</span>
              <span className="text-sm text-muted">
                <strong className="font-semibold text-text">{title}</strong> — {desc}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-9 rise" style={{ animationDelay: "240ms" }}>
        <Eyebrow>Demo consoles</Eyebrow>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {CONSOLES.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="card-quiet px-3.5 py-3 transition hover:border-line-strong hover:bg-surface"
            >
              <span className="flex items-center gap-2">
                <span className="size-1.5 rounded-full" style={{ background: c.dot }} />
                <span className="text-[11px] text-faint">{c.role}</span>
              </span>
              <span className="mt-1 block text-sm font-medium text-text">{c.label}</span>
            </Link>
          ))}
          <Link
            href="/admin"
            className="card-quiet col-span-2 flex items-center justify-between px-3.5 py-3 transition hover:border-line-strong hover:bg-surface"
          >
            <span>
              <span className="flex items-center gap-2">
                <span className="size-1.5 rounded-full" style={{ background: "var(--implant)" }} />
                <span className="text-[11px] text-faint">Admin</span>
              </span>
              <span className="mt-1 block text-sm font-medium text-text">Onboard clinicians</span>
            </span>
            <span className="text-implant">→</span>
          </Link>
        </div>
      </section>

      <p className="mt-10 text-center text-[11px] text-faint">
        Team LifeScan AI · Madhav Institute of Technology &amp; Science, Gwalior
      </p>
    </main>
  );
}
