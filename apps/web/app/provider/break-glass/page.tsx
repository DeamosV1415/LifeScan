"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { keccak256, toHex, zeroHash } from "viem";
import {
  ACCESS_LOG_ABI,
  CHAIN,
  REASON_CODES,
  explorerTx,
  patientHash as toPatientHash,
  publicClient,
  requireAddress,
} from "@/lib/contracts";
import { collectShares, challengeMessage, decryptRecord } from "@/lib/guardians";
import { useProviderWallet } from "@/lib/useProviderWallet";
import { DEMO_PATIENT_ID, type Tier1Record } from "@/lib/record";
import { Wordmark, Eyebrow, PageShell } from "@/components/ui";
import { FundButton } from "@/components/FundButton";
import { Collapsible } from "@/components/Collapsible";

/**
 * The break-glass flow — the centre of the demo.
 *
 * Every step announces itself in a live trace so judges watch the mechanism
 * work rather than trusting a spinner: the on-chain grant confirms, then each
 * Guardian is asked in turn and either releases or refuses on the record, and
 * only then does the record decrypt in the browser.
 */

type Phase = "idle" | "granting" | "collecting" | "decrypting" | "open" | "error";

interface TraceEntry {
  text: string;
  tone: "info" | "ok" | "warn" | "chain";
  href?: string;
}

// A break-glass target can be given either as a patient id (which we hash) or as
// an already-computed 32-byte patientHash pasted straight from a tag or backend.
const HEX32 = /^0x[0-9a-fA-F]{64}$/;

function BreakGlassInner() {
  const params = useSearchParams();
  // Editable so a provider can target any patient — prefilled from the scan
  // card's ?patient= param, falling back to the demo patient.
  const [patientId, setPatientId] = useState(params.get("patient") || DEMO_PATIENT_ID);
  const patientHash = useMemo(() => {
    const v = patientId.trim();
    return HEX32.test(v) ? (v as `0x${string}`) : toPatientHash(v);
  }, [patientId]);

  const { ready, authenticated, login } = usePrivy();
  const { address, getWalletClient, signMessage, hasWallet } = useProviderWallet();

  const [phase, setPhase] = useState<Phase>("idle");
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [record, setRecord] = useState<Tier1Record | null>(null);
  const [reason, setReason] = useState<number>(REASON_CODES.TRAUMA);
  const [note, setNote] = useState("");

  const log = useCallback((entry: TraceEntry) => setTrace((t) => [...t, entry]), []);

  const breakGlass = useCallback(async () => {
    setTrace([]);
    setRecord(null);
    setPhase("granting");

    try {
      const contextHash = note.trim() ? keccak256(toHex(note.trim())) : zeroHash;

      // Hand the paramedic's free-text context to the agent off-chain (the
      // chain carries only its hash). Best-effort — the agent falls back to the
      // reason code if this does not arrive, so a failure here never blocks
      // break-glass itself.
      if (note.trim()) {
        const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL;
        if (agentUrl) {
          fetch(`${agentUrl}/context`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ patientHash, context: note.trim() }),
          }).catch(() => {});
        }
      }

      // 1. The on-chain grant. This is the attributable, immutable record.
      log({ text: "Signing break-glass on Base Sepolia…", tone: "info" });
      const wallet = await getWalletClient();
      const txHash = await wallet.writeContract({
        address: requireAddress("accessLog"),
        abi: ACCESS_LOG_ABI,
        functionName: "requestBreakGlass",
        args: [patientHash, reason, contextHash],
        account: address!,
        chain: CHAIN,
      });
      log({ text: "Transaction submitted", tone: "chain", href: explorerTx(txHash) });

      const receipt = await publicClient().waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error("Break-glass transaction reverted.");
      log({ text: `Grant confirmed in block ${receipt.blockNumber}`, tone: "ok", href: explorerTx(txHash) });

      // 2. The Guardians, each checking the chain themselves.
      setPhase("collecting");
      log({ text: "Asking the Guardian network to release key shares…", tone: "info" });

      const result = await collectShares({
        patientHash,
        provider: address!,
        threshold: 2,
        signChallenge: (message) => signMessage(message),
      });

      for (const id of result.releasedBy) {
        log({ text: `Guardian ${id} verified the grant on-chain and released its share`, tone: "ok" });
      }
      for (const refusal of result.refusals) {
        log({ text: `Guardian ${refusal.id} refused: ${refusal.reason}`, tone: "warn" });
      }

      if (result.shares.length < 2) {
        throw new Error(
          "Fewer than two Guardians released a share — the record stays sealed. " +
            "This is the system working: it refuses when the chain says no.",
        );
      }
      log({ text: `Threshold met — reconstructing the key from 2 of 3 shares`, tone: "ok" });

      // 3. Decrypt, in the browser. The server never sees the key.
      setPhase("decrypting");
      const res = await fetch(`/api/records?hash=${patientHash}`);
      if (!res.ok) throw new Error("No encrypted record is mirrored for this patient yet.");
      const { ciphertext } = await res.json();

      const decrypted = await decryptRecord(ciphertext, result.shares);
      setRecord(decrypted);
      setPhase("open");
      log({ text: "Record decrypted locally. The server never held the key.", tone: "ok" });
    } catch (error) {
      log({ text: error instanceof Error ? error.message : "Unknown error", tone: "warn" });
      setPhase("error");
    }
  }, [address, getWalletClient, log, note, patientHash, reason, signMessage]);

  if (!ready) {
    return (
      <PageShell>
        <p className="text-muted">Loading…</p>
      </PageShell>
    );
  }

  if (!authenticated) {
    return (
      <PageShell>
        <Wordmark />
        <h1 className="mt-9 text-2xl font-bold text-text">Provider access</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Break-glass is restricted to registered clinicians. Sign in with your
          hospital email — a secure wallet is created for you, no seed phrase.
        </p>
        <button onClick={login} className="btn btn-vital btn-block mt-6">
          Sign in
        </button>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Wordmark size="sm" />

      <div className="mt-7 rise">
        <Eyebrow>Provider console</Eyebrow>
        <h1 className="mt-2 text-2xl font-bold text-text">Break glass</h1>
        <p className="mt-1.5 font-mono text-xs break-all text-faint">
          Patient <span className="text-info">{patientId}</span> · {patientHash.slice(0, 18)}…
        </p>
        {address && (
          <p className="mt-1.5 font-mono text-[11px] break-all text-faint">your wallet {address}</p>
        )}
        {address && <FundButton address={address} />}
      </div>

      {!hasWallet && (
        <p className="mt-4 rounded-xl border border-caution/30 bg-caution/10 p-3 text-xs text-caution">
          Preparing your secure wallet… if this persists, reload once.
        </p>
      )}

      {phase === "idle" || phase === "error" ? (
        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="eyebrow">Patient id or hash</span>
            <input
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              placeholder="ramesh-kumar-1989  or  0x…"
              className="input mt-1.5 font-mono"
            />
            <span className="mt-1 block text-[11px] text-faint">
              The id from the patient&apos;s card, or paste a 0x… patientHash
              directly. Defaults to the demo patient.
            </span>
          </label>

          <label className="block">
            <span className="eyebrow">Reason for access</span>
            <select
              value={reason}
              onChange={(e) => setReason(Number(e.target.value))}
              className="input mt-1.5"
            >
              <option value={REASON_CODES.UNCONSCIOUS}>Unconscious patient</option>
              <option value={REASON_CODES.TRAUMA}>Trauma / RTA</option>
              <option value={REASON_CODES.CARDIAC}>Cardiac event</option>
              <option value={REASON_CODES.OVERDOSE}>Suspected overdose</option>
              <option value={REASON_CODES.OTHER}>Other emergency</option>
            </select>
          </label>

          <label className="block">
            <span className="eyebrow">Clinical context — optional, its hash is anchored on-chain</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="male ~35, RTA, GCS 9, BP 90/60"
              className="input mt-1.5 resize-none"
            />
          </label>

          <button
            onClick={breakGlass}
            disabled={!hasWallet}
            className="btn btn-danger btn-block py-5 text-lg tracking-wide uppercase"
          >
            🔴 Break glass
          </button>
          <p className="text-center text-[11px] text-faint">
            This access is permanent, attributable to you, and visible to the
            patient in real time.
          </p>
        </div>
      ) : null}

      {trace.length > 0 && (
        <div className="mt-7">
          <Collapsible
            title="Break-glass trace"
            live={phase === "granting" || phase === "collecting" || phase === "decrypting"}
            meta={<span className="text-[11px] text-faint tnum">{trace.length}</span>}
            defaultOpen
          >
            <ol className="space-y-2.5 border-l border-line pt-1 pl-4">
              {trace.map((entry, i) => (
            <li key={i} className="relative text-sm">
              <span
                className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full"
                style={{
                  background:
                    entry.tone === "ok"
                      ? "var(--vital)"
                      : entry.tone === "warn"
                        ? "var(--caution)"
                        : entry.tone === "chain"
                          ? "var(--info)"
                          : "var(--faint)",
                }}
              />
              <span
                className={
                  entry.tone === "ok"
                    ? "text-vital"
                    : entry.tone === "warn"
                      ? "text-caution"
                      : entry.tone === "chain"
                        ? "text-info"
                        : "text-muted"
                }
              >
                {entry.text}
              </span>
              {entry.href && (
                <a href={entry.href} target="_blank" rel="noreferrer" className="link ml-2">
                  view on Basescan ↗
                </a>
              )}
            </li>
              ))}
            </ol>
          </Collapsible>
        </div>
      )}

      {record && (
        <>
          <RecordView record={record} />
          <a
            href="/er"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-block mt-4"
          >
            See the agent&apos;s triage on the ER board →
          </a>
        </>
      )}
    </PageShell>
  );
}

function RecordView({ record }: { record: Tier1Record }) {
  return (
    <div
      className="card mt-8 p-5 rise"
      style={{ borderColor: "color-mix(in srgb, var(--vital) 30%, transparent)" }}
    >
      <p className="eyebrow" style={{ color: "var(--vital)" }}>
        Tier 1 · clinical record
      </p>
      <h2 className="mt-2 text-xl font-bold text-text">{record.name}</h2>
      <p className="text-sm text-muted">
        {record.bloodGroup} · DOB {record.dob}
      </p>

      <Section title="Conditions" items={record.conditions} />
      <Section
        title="Medications"
        items={record.medications.map((m) => `${m.name} ${m.dose}, ${m.frequency}`)}
      />
      <Section
        title="Allergies"
        items={record.allergies.map((a) => `${a.substance} — ${a.reaction} (${a.severity})`)}
        alarming
      />
      <Section
        title="Implants"
        items={record.implants.map((i) => `${i.type}${i.model ? ` (${i.model})` : ""}`)}
      />
      {record.notes && (
        <p className="mt-4 rounded-xl border border-caution/30 bg-caution/10 p-3 text-sm text-caution">
          {record.notes}
        </p>
      )}
    </div>
  );
}

function Section({ title, items, alarming }: { title: string; items: string[]; alarming?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="eyebrow">{title}</p>
      <ul className="mt-1.5 space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className={`text-sm ${alarming ? "font-semibold text-critical" : "text-text"}`}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function BreakGlassPage() {
  return (
    <Suspense
      fallback={
        <PageShell>
          <p className="text-muted">Loading…</p>
        </PageShell>
      }
    >
      <BreakGlassInner />
    </Suspense>
  );
}
