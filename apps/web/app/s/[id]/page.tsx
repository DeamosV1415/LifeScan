"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import { parseTier0, FLAG_LABELS, MISSING, type Tier0 } from "@/lib/tier0";

/**
 * Tier-0 scan view — what a paramedic sees the instant they tap the card.
 *
 * Everything rendered here comes from the URL fragment, which the browser
 * never transmits. That means this page needs no network, no database and no
 * account: with the app installed, it renders in airplane mode.
 */
export default function ScanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<Tier0 | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const read = () => setData(parseTier0(window.location.hash));
    read();
    window.addEventListener("hashchange", read);

    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);

    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // Pre-hydration: the fragment isn't readable during SSR.
  if (!data) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-ink-950 p-6">
        <p className="text-sm tracking-widest text-ink-600 uppercase">Reading card…</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-ink-950 pb-16">
      <StatusBar online={online} cardId={id} />

      {!data.valid && <ParseWarning message={data.error} />}

      <div className="mx-auto w-full max-w-md px-4">
        <PatientName name={data.name} />
        <BloodGroup value={data.bloodGroup} />
        <Allergies items={data.allergies} />
        <Flags items={data.flags} />
        <EmergencyContact value={data.emergencyContact} />
        <BreakGlassCta cardId={id} />
        <Provenance />
      </div>
    </main>
  );
}

function StatusBar({ online, cardId }: { online: boolean; cardId: string }) {
  return (
    <header className="border-b border-ink-800 bg-ink-900/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded bg-critical text-xs font-black text-white">
            +
          </span>
          <span className="text-xs font-bold tracking-[0.2em] text-white uppercase">
            LifeScan
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-ink-600">#{cardId}</span>
          {/* Offline is a feature here, not an error — say so plainly. */}
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
              online
                ? "bg-ink-800 text-ink-600"
                : "bg-vital/15 text-vital ring-1 ring-vital/40"
            }`}
          >
            {online ? "Online" : "Offline · working"}
          </span>
        </div>
      </div>
    </header>
  );
}

function ParseWarning({ message }: { message?: string }) {
  return (
    <div className="mx-auto mt-4 w-full max-w-md px-4">
      <div className="rounded-lg border border-caution/40 bg-caution/10 px-4 py-3">
        <p className="text-sm font-semibold text-caution">Card could not be read</p>
        <p className="mt-1 text-xs text-caution/80">
          {message ?? "Unknown error."} Check the printed details on the card itself.
        </p>
      </div>
    </div>
  );
}

function PatientName({ name }: { name: string }) {
  return (
    <div className="pt-6 pb-2">
      <p className="text-[10px] font-semibold tracking-[0.2em] text-ink-600 uppercase">
        Patient
      </p>
      <h1 className="mt-1 text-2xl font-bold text-white">
        {name || <span className="text-ink-600">{MISSING}</span>}
      </h1>
    </div>
  );
}

/** The single most time-critical fact on the card. Largest element on screen. */
function BloodGroup({ value }: { value: string }) {
  return (
    <section className="mt-4 rounded-2xl border border-vital/30 bg-vital/10 px-5 py-6">
      <p className="text-[10px] font-semibold tracking-[0.2em] text-vital uppercase">
        Blood group
      </p>
      {value ? (
        <p className="mt-1 text-7xl leading-none font-black tracking-tight text-vital">
          {value}
        </p>
      ) : (
        <p className="mt-2 text-2xl font-bold text-ink-600">{MISSING}</p>
      )}
    </section>
  );
}

function Allergies({ items }: { items: string[] }) {
  const hasData = items.length > 0;
  return (
    <section
      className={`mt-3 rounded-2xl border px-5 py-4 ${
        hasData ? "border-critical/40 bg-critical/10" : "border-ink-800 bg-ink-900"
      }`}
    >
      <p
        className={`text-[10px] font-semibold tracking-[0.2em] uppercase ${
          hasData ? "text-critical" : "text-ink-600"
        }`}
      >
        Allergies
      </p>
      {hasData ? (
        <ul className="mt-2 space-y-1">
          {items.map((allergy) => (
            <li
              key={allergy}
              className="text-2xl leading-tight font-bold text-critical"
            >
              {allergy}
            </li>
          ))}
        </ul>
      ) : (
        // Critical distinction: "not recorded" is NOT "no allergies". A blank
        // field must never be read as a clearance to administer a drug.
        <p className="mt-2 text-lg font-semibold text-ink-600">
          {MISSING}
          <span className="mt-1 block text-xs font-normal">
            Absence of data is not evidence of no allergy.
          </span>
        </p>
      )}
    </section>
  );
}

function Flags({ items }: { items: string[] }) {
  if (items.length === 0) return null;

  return (
    <section className="mt-3 rounded-2xl border border-implant/30 bg-implant/10 px-5 py-4">
      <p className="text-[10px] font-semibold tracking-[0.2em] text-implant uppercase">
        Implants &amp; directives
      </p>
      <ul className="mt-2 space-y-3">
        {items.map((flag) => {
          const known = FLAG_LABELS[flag.toUpperCase()];
          return (
            <li key={flag}>
              <p className="text-lg font-bold text-implant">
                {known?.label ?? flag}
              </p>
              {known && (
                <p className="mt-0.5 text-xs text-implant/80">{known.caution}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EmergencyContact({ value }: { value: string }) {
  return (
    <section className="mt-3 rounded-2xl border border-ink-800 bg-ink-900 px-5 py-4">
      <p className="text-[10px] font-semibold tracking-[0.2em] text-ink-600 uppercase">
        Emergency contact
      </p>
      {value ? (
        <a
          href={`tel:${value.replace(/\s/g, "")}`}
          className="mt-1 block text-2xl font-bold text-info underline-offset-4 hover:underline"
        >
          {value}
        </a>
      ) : (
        <p className="mt-1 text-lg font-semibold text-ink-600">{MISSING}</p>
      )}
    </section>
  );
}

function BreakGlassCta({ cardId }: { cardId: string }) {
  return (
    <section className="mt-6">
      <a
        href={`/provider/break-glass?patient=${encodeURIComponent(cardId)}`}
        className="block rounded-xl border border-critical/50 bg-critical/15 px-5 py-4 text-center transition hover:bg-critical/25"
      >
        <span className="block text-base font-bold text-critical">
          Break glass — full medical record
        </span>
        <span className="mt-1 block text-xs text-critical/70">
          Registered clinicians only · requires network · permanently logged
        </span>
      </a>
    </section>
  );
}

function Provenance() {
  return (
    <p className="mt-6 text-center text-[11px] leading-relaxed text-ink-600">
      This screen is stored on the card itself and works with no network.
      <br />
      Nothing shown here was sent to or retrieved from any server.
    </p>
  );
}
