"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The ER dashboard — the receiving hospital's screen.
 *
 * It subscribes to the agent's live trace over SSE and lights up with the
 * incoming patient before the ambulance arrives. The triage assessment and SBAR
 * note are pulled out of the stream and shown as a proper handoff card; the raw
 * trace runs alongside so judges see the agent working in real time.
 */

interface TraceEvent {
  patientHash: string;
  ts: number;
  kind: "trigger" | "perceive" | "reason" | "tool" | "chain" | "done" | "error";
  text: string;
  href?: string;
  data?: unknown;
}

interface Triage {
  bloodGroup: string;
  criticalAllergies: string[];
  contraindications: string[];
  interactions: string[];
  implantCautions: string[];
}

interface Sbar {
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
}

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:4100";

const KIND_STYLE: Record<TraceEvent["kind"], string> = {
  trigger: "text-implant",
  perceive: "text-info",
  reason: "text-ink-600",
  tool: "text-white",
  chain: "text-vital",
  done: "text-vital",
  error: "text-critical",
};

export default function ErDashboard() {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource(`${AGENT_URL}/trace`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      try {
        setEvents((prev) => [...prev, JSON.parse(e.data)]);
      } catch {
        /* ignore malformed frame */
      }
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [events]);

  // Pull the structured artifacts out of the most recent run.
  const triage = useMemo(
    () => lastToolData<Triage>(events, "Triage assessment recorded"),
    [events],
  );
  const sbar = useMemo(() => lastToolData<Sbar>(events, "SBAR handoff generated"), [events]);
  const active = events.some((e) => e.kind === "trigger") && !events.some((e) => e.kind === "done");

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-5 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Emergency Department</h1>
          <p className="text-xs text-ink-600">Gwalior Trauma Centre · incoming patient board</p>
        </div>
        <span
          className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
            connected ? "bg-vital/10 text-vital" : "bg-ink-800 text-ink-600"
          }`}
        >
          <span className={`size-2 rounded-full ${connected ? "bg-vital" : "bg-ink-600"}`} />
          {connected ? "Live" : "Connecting…"}
        </span>
      </header>

      {!triage && (
        <div className="mt-16 text-center text-ink-600">
          <p className="text-sm">Waiting for an incoming patient…</p>
          <p className="mt-1 text-xs">
            This board lights up the moment a clinician breaks glass — the agent
            pushes the triage here before the ambulance arrives.
          </p>
        </div>
      )}

      {triage && (
        <section
          className={`mt-6 rounded-2xl border p-5 ${
            active ? "border-caution/50 bg-caution/5" : "border-vital/30 bg-ink-900"
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold tracking-widest text-caution uppercase">
              {active ? "◉ Incoming — triage in progress" : "Incoming patient"}
            </p>
            <span className="text-3xl font-black text-critical">{triage.bloodGroup}</span>
          </div>

          {triage.contraindications.length > 0 && (
            <div className="mt-4 rounded-xl bg-critical/10 p-4">
              <p className="text-xs font-bold tracking-wide text-critical uppercase">
                ⚠ Contraindications — act on these first
              </p>
              <ul className="mt-2 space-y-1">
                {triage.contraindications.map((c, i) => (
                  <li key={i} className="text-sm font-semibold text-critical">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <Field label="Critical allergies" items={triage.criticalAllergies} tone="critical" />
            <Field label="Interactions" items={triage.interactions} />
            <Field label="Implant cautions" items={triage.implantCautions} />
          </div>

          {sbar && (
            <div className="mt-5 border-t border-ink-800 pt-4">
              <p className="text-[11px] font-semibold tracking-widest text-info uppercase">
                SBAR handoff
              </p>
              <dl className="mt-2 space-y-1.5 text-sm">
                <SbarLine k="S" label="Situation" v={sbar.situation} />
                <SbarLine k="B" label="Background" v={sbar.background} />
                <SbarLine k="A" label="Assessment" v={sbar.assessment} />
                <SbarLine k="R" label="Recommendation" v={sbar.recommendation} />
              </dl>
            </div>
          )}
        </section>
      )}

      <section className="mt-6">
        <p className="text-[11px] font-semibold tracking-widest text-ink-600 uppercase">
          Agent trace · live
        </p>
        <div
          ref={feedRef}
          className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-ink-800 bg-ink-950 p-4 font-mono text-xs"
        >
          {events.length === 0 ? (
            <p className="text-ink-600">No activity yet.</p>
          ) : (
            <ol className="space-y-1.5">
              {events.map((e, i) => (
                <li key={i} className={KIND_STYLE[e.kind]}>
                  <span className="text-ink-600">[{e.kind}]</span> {e.text}
                  {e.href && (
                    <a href={e.href} target="_blank" rel="noreferrer" className="ml-2 text-info underline">
                      tx ↗
                    </a>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </main>
  );
}

function lastToolData<T>(events: TraceEvent[], label: string): T | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === "tool" && events[i].text === label && events[i].data) {
      return events[i].data as T;
    }
  }
  return null;
}

function Field({ label, items, tone }: { label: string; items: string[]; tone?: "critical" }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold tracking-widest text-ink-600 uppercase">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className={tone === "critical" ? "font-semibold text-critical" : "text-white"}>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SbarLine({ k, label, v }: { k: string; label: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="flex size-5 shrink-0 items-center justify-center rounded bg-info/20 text-[11px] font-bold text-info">
        {k}
      </dt>
      <dd className="text-white">
        <span className="text-ink-600">{label}:</span> {v}
      </dd>
    </div>
  );
}
