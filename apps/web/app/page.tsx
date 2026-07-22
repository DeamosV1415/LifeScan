import Link from "next/link";
import { buildTier0 } from "@/lib/tier0";

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

export default function Home() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-5 py-10">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded bg-critical text-sm font-black text-white">
          +
        </span>
        <span className="text-sm font-bold tracking-[0.2em] text-white uppercase">
          LifeScan
        </span>
      </div>

      <h1 className="mt-8 text-3xl leading-tight font-bold text-white">
        Emergency medical identity that works when nothing else does.
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-600">
        Tap the card. Blood group, allergies and implants appear in under a
        second — with no signal, no app store and no account. The full clinical
        record stays encrypted until a registered clinician breaks glass, and
        every access is permanently logged on-chain.
      </p>

      <div className="mt-8 space-y-3">
        <Link
          href={`/s/preview#${DEMO_FRAGMENT}`}
          className="block rounded-xl border border-vital/40 bg-vital/10 px-5 py-4 transition hover:bg-vital/20"
        >
          <span className="block text-base font-bold text-vital">
            Open a demo card
          </span>
          <span className="mt-1 block text-xs text-vital/70">
            Exactly what a paramedic sees on scan
          </span>
        </Link>

        <div className="rounded-xl border border-ink-800 bg-ink-900 px-5 py-4">
          <p className="text-sm font-bold text-white">Install for offline use</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">
            Browser menu → <strong className="text-ink-600">Install app</strong> or{" "}
            <strong className="text-ink-600">Add to Home screen</strong>. Open it
            once while online. After that, card taps work in airplane mode.
          </p>
        </div>
      </div>

      <div className="mt-10 border-t border-ink-800 pt-6">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-ink-600 uppercase">
          Three layers of redundancy
        </p>
        <ul className="mt-3 space-y-2 text-xs text-ink-600">
          <li>
            <strong className="text-white">Printed</strong> — readable with no
            device at all
          </li>
          <li>
            <strong className="text-white">QR code</strong> — any camera phone,
            no app
          </li>
          <li>
            <strong className="text-white">NFC tap</strong> — one tap, fastest
            path
          </li>
        </ul>
      </div>

      <div className="mt-10 border-t border-ink-800 pt-6">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-ink-600 uppercase">
          Demo consoles
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <Link href="/patient" className="rounded-lg border border-ink-800 px-3 py-2 text-white transition hover:border-ink-700">
            Patient · issue card
          </Link>
          <Link href="/patient/audit" className="rounded-lg border border-ink-800 px-3 py-2 text-white transition hover:border-ink-700">
            Patient · access log
          </Link>
          <Link href="/provider/break-glass" className="rounded-lg border border-ink-800 px-3 py-2 text-white transition hover:border-ink-700">
            Provider · break glass
          </Link>
          <Link href="/er" className="rounded-lg border border-ink-800 px-3 py-2 text-white transition hover:border-ink-700">
            ER · incoming board
          </Link>
        </div>
      </div>

      <p className="mt-10 text-center text-[11px] text-ink-600">
        Team LifeScan AI · Madhav Institute of Technology &amp; Science, Gwalior
      </p>
    </main>
  );
}
