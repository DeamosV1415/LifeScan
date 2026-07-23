"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import { parseTier0, FLAG_LABELS, MISSING, type Tier0 } from "@/lib/tier0";
import { Wordmark } from "@/components/ui";

/**
 * Tier-0 scan view — what a paramedic sees the instant they tap the card.
 *
 * Everything rendered here comes from the URL fragment, which the browser
 * never transmits. That means this page needs no network, no database and no
 * account: with the app installed, it renders in airplane mode.
 *
 * This is the one screen where colour stays loud on purpose — a blood group
 * and an allergy must read across a chaotic roadside in a fraction of a second.
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
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="eyebrow">Reading card…</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh pb-16">
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
    <header className="sticky top-0 z-10 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-3">
        <Wordmark size="sm" plain />
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[10px] text-faint">#{cardId}</span>
          {/* Offline is a feature here, not an error — say so plainly. */}
          <span className={`chip ${online ? "chip-muted" : "chip-vital"}`}>
            {online ? (
              "Online"
            ) : (
              <>
                <span className="size-1.5 rounded-full bg-vital" />
                Offline · working
              </>
            )}
          </span>
        </div>
      </div>
    </header>
  );
}

function ParseWarning({ message }: { message?: string }) {
  return (
    <div className="mx-auto mt-4 w-full max-w-md px-4">
      <div className="rounded-xl border border-caution/40 bg-caution/10 px-4 py-3">
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
    <div className="pt-6 pb-1 rise">
      <p className="eyebrow">Patient</p>
      <h1 className="mt-1.5 text-[1.7rem] leading-tight font-bold text-text">
        {name || <span className="text-faint">{MISSING}</span>}
      </h1>
    </div>
  );
}

/** The single most time-critical fact on the card. Largest element on screen. */
function BloodGroup({ value }: { value: string }) {
  return (
    <section
      className="mt-4 overflow-hidden rounded-2xl border px-5 py-6 rise"
      style={{
        animationDelay: "60ms",
        borderColor: "color-mix(in srgb, var(--vital) 32%, transparent)",
        background:
          "linear-gradient(160deg, color-mix(in srgb, var(--vital) 14%, transparent), color-mix(in srgb, var(--vital) 4%, transparent))",
      }}
    >
      <p className="eyebrow" style={{ color: "var(--vital)" }}>
        Blood group
      </p>
      {value ? (
        <p className="font-display mt-1 text-[5.5rem] leading-none font-bold tracking-tight text-vital tnum">
          {value}
        </p>
      ) : (
        <p className="mt-2 text-2xl font-bold text-faint">{MISSING}</p>
      )}
    </section>
  );
}

function Allergies({ items }: { items: string[] }) {
  const hasData = items.length > 0;
  return (
    <section
      className={`mt-3 rounded-2xl border px-5 py-4 rise ${
        hasData ? "border-critical/45" : "border-line"
      }`}
      style={{
        animationDelay: "120ms",
        background: hasData
          ? "linear-gradient(160deg, color-mix(in srgb, var(--danger) 15%, transparent), color-mix(in srgb, var(--danger) 5%, transparent))"
          : "var(--surface)",
      }}
    >
      <p className="eyebrow" style={hasData ? { color: "var(--danger)" } : undefined}>
        Allergies
      </p>
      {hasData ? (
        <ul className="mt-2 space-y-1">
          {items.map((allergy) => (
            <li key={allergy} className="text-[1.6rem] leading-tight font-bold text-critical">
              {allergy}
            </li>
          ))}
        </ul>
      ) : (
        // Critical distinction: "not recorded" is NOT "no allergies". A blank
        // field must never be read as a clearance to administer a drug.
        <p className="mt-2 text-lg font-semibold text-faint">
          {MISSING}
          <span className="mt-1 block text-xs font-normal text-muted">
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
    <section
      className="mt-3 rounded-2xl border border-implant/35 px-5 py-4 rise"
      style={{
        animationDelay: "180ms",
        background: "linear-gradient(160deg, color-mix(in srgb, var(--implant) 12%, transparent), transparent)",
      }}
    >
      <p className="eyebrow" style={{ color: "var(--implant)" }}>
        Implants &amp; directives
      </p>
      <ul className="mt-2.5 space-y-3">
        {items.map((flag) => {
          const known = FLAG_LABELS[flag.toUpperCase()];
          return (
            <li key={flag}>
              <p className="text-lg font-bold text-implant">{known?.label ?? flag}</p>
              {known && <p className="mt-0.5 text-xs text-implant/85">{known.caution}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EmergencyContact({ value }: { value: string }) {
  return (
    <section className="card mt-3 px-5 py-4 rise" style={{ animationDelay: "220ms" }}>
      <p className="eyebrow">Emergency contact</p>
      {value ? (
        <a
          href={`tel:${value.replace(/\s/g, "")}`}
          className="mt-1 block text-2xl font-bold text-info underline-offset-4 hover:underline"
        >
          {value}
        </a>
      ) : (
        <p className="mt-1 text-lg font-semibold text-faint">{MISSING}</p>
      )}
    </section>
  );
}

function BreakGlassCta({ cardId }: { cardId: string }) {
  return (
    <section className="mt-6 rise" style={{ animationDelay: "260ms" }}>
      <a
        href={`/provider/break-glass?patient=${encodeURIComponent(cardId)}`}
        className="block rounded-2xl border border-critical/45 px-5 py-4 text-center transition hover:border-critical/70"
        style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)" }}
      >
        <span className="block text-base font-semibold text-critical">
          Break glass — full medical record
        </span>
        <span className="mt-1 block text-xs text-critical/75">
          Registered clinicians only · requires network · permanently logged
        </span>
      </a>
    </section>
  );
}

function Provenance() {
  return (
    <p className="mt-6 text-center text-[11px] leading-relaxed text-faint">
      This screen is stored on the card itself and works with no network.
      <br />
      Nothing shown here was sent to or retrieved from any server.
    </p>
  );
}
