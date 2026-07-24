"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Wordmark, Eyebrow, LivePill } from "@/components/ui";
import { Collapsible } from "@/components/Collapsible";

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

interface PreAuth {
  provisionalDiagnosis: string;
  estimatedAmountInr: number;
  itemization: string[];
  /** The patient's actual policy, forwarded from the decrypted record. */
  policy?: { provider?: string; policyNo?: string; sumInsured?: string };
}

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:4100";

const KIND_STYLE: Record<TraceEvent["kind"], string> = {
  trigger: "text-implant",
  perceive: "text-info",
  reason: "text-muted",
  tool: "text-text",
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
  const preauth = useMemo(
    () => lastToolData<PreAuth>(events, "Insurance pre-auth packet prepared"),
    [events],
  );
  const active = events.some((e) => e.kind === "trigger") && !events.some((e) => e.kind === "done");

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-5 py-8 sm:px-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <Wordmark size="sm" />
          <h1 className="mt-3 text-xl font-bold text-text">Emergency Department</h1>
          <p className="text-xs text-muted">Gwalior Trauma Centre · incoming patient board</p>
        </div>
        <LivePill live={connected} />
      </header>

      {!triage && (
        <div className="mt-16 flex flex-col items-center text-center">
          <span className="grid size-12 place-items-center rounded-full border border-line text-2xl">
            🚑
          </span>
          <p className="mt-4 text-sm font-medium text-text">Waiting for an incoming patient…</p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">
            This board lights up the moment a clinician breaks glass — the agent
            pushes the triage here before the ambulance arrives.
          </p>
        </div>
      )}

      {triage && (
        <section
          className={`mt-6 rounded-2xl border p-4 shadow-card rise sm:p-5 ${
            active ? "border-caution/50" : "border-vital/30"
          }`}
          style={{
            background: active
              ? "linear-gradient(160deg, color-mix(in srgb, var(--caution) 8%, transparent), var(--surface))"
              : "var(--surface)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <p
              className="eyebrow flex items-center gap-2"
              style={{ color: active ? "var(--caution)" : "var(--vital)" }}
            >
              {active && <span className="size-2 rounded-full bg-caution live-dot" />}
              {active ? "Incoming — triage in progress" : "Incoming patient"}
            </p>
            <span className="font-display text-4xl leading-none font-bold text-critical tnum">
              {triage.bloodGroup}
            </span>
          </div>

          {triage.contraindications.length > 0 && (
            <div className="mt-4 rounded-xl border border-critical/30 bg-critical/10 p-3.5">
              <p className="eyebrow" style={{ color: "var(--danger)" }}>
                ⚠ Contraindications — act on these first
              </p>
              <ul className="mt-2.5 space-y-2.5">
                {triage.contraindications.map((c, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-relaxed font-semibold text-critical">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-critical" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-4 text-sm sm:grid-cols-2">
            <Field label="Critical allergies" items={triage.criticalAllergies} tone="critical" />
            <Field label="Interactions" items={triage.interactions} />
            <Field label="Implant cautions" items={triage.implantCautions} />
          </div>
        </section>
      )}

      {sbar && (
        <div className="mt-4">
          <Collapsible title="SBAR handoff" accent="var(--info)" defaultOpen>
            <dl className="space-y-2.5 pt-1 text-sm">
              <SbarLine k="S" label="Situation" v={sbar.situation} />
              <SbarLine k="B" label="Background" v={sbar.background} />
              <SbarLine k="A" label="Assessment" v={sbar.assessment} />
              <SbarLine k="R" label="Recommendation" v={sbar.recommendation} />
            </dl>
          </Collapsible>
        </div>
      )}

      {preauth && (
        <section className="card mt-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Eyebrow className="!text-info">Insurance pre-auth · prepared</Eyebrow>
            <span className="chip chip-info">awaiting human release</span>
          </div>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm text-text">{preauth.provisionalDiagnosis}</p>
            <div className="text-right">
              <p className="eyebrow">Est. claim</p>
              <p className="font-display text-xl font-bold text-text tnum">
                ₹{preauth.estimatedAmountInr.toLocaleString("en-IN")}
              </p>
            </div>
          </div>

          {preauth.policy && (preauth.policy.provider || preauth.policy.sumInsured || preauth.policy.policyNo) && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-[var(--field)] px-3 py-2 text-xs">
              <span className="text-muted">
                {preauth.policy.provider || "Policy"}
                {preauth.policy.policyNo && (
                  <span className="ml-1.5 font-mono text-faint">· {preauth.policy.policyNo}</span>
                )}
              </span>
              {preauth.policy.sumInsured && (
                <span className="text-text">
                  <span className="text-faint">cover </span>
                  <span className="font-semibold text-vital">{preauth.policy.sumInsured}</span>
                </span>
              )}
            </div>
          )}

          {preauth.itemization.length > 0 && (
            <ul className="mt-2.5 space-y-1 text-xs text-muted">
              {preauth.itemization.map((it, i) => (
                <li key={i}>· {it}</li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            The agent prepared and anchored this packet. Funds are released by a
            human admin — never the agent.
          </p>
        </section>
      )}

      <div className="mt-4">
        <Collapsible
          title="Agent trace · live"
          live={connected}
          meta={<span className="text-[11px] text-faint tnum">{events.length}</span>}
          defaultOpen
        >
          <div
            ref={feedRef}
            className="max-h-72 overflow-y-auto rounded-xl border border-line bg-bg-2 p-3.5 font-mono text-xs"
          >
            {events.length === 0 ? (
              <p className="text-faint">No activity yet.</p>
            ) : (
              <ol className="space-y-1.5">
                {events.map((e, i) => (
                  <li key={i} className={`leading-relaxed ${KIND_STYLE[e.kind]}`}>
                    <span className="text-faint">[{e.kind}]</span> {e.text}
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
        </Collapsible>
      </div>
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
      <p className="eyebrow">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className={tone === "critical" ? "font-semibold text-critical" : "text-text"}>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SbarLine({ k, label, v }: { k: string; label: string; v: string }) {
  return (
    <div className="flex gap-2.5">
      <dt className="flex size-5 shrink-0 items-center justify-center rounded-md bg-info/20 font-mono text-[11px] font-bold text-info">
        {k}
      </dt>
      <dd className="text-text">
        <span className="text-faint">{label}:</span> {v}
      </dd>
    </div>
  );
}
