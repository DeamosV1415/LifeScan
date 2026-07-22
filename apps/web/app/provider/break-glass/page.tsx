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

function BreakGlassInner() {
  const params = useSearchParams();
  const patientId = params.get("patient") || DEMO_PATIENT_ID;
  const patientHash = useMemo(() => toPatientHash(patientId), [patientId]);

  const { ready, authenticated, login, user } = usePrivy();
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
    return <Shell><p className="text-ink-600">Loading…</p></Shell>;
  }

  if (!authenticated) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold text-white">Provider access</h1>
        <p className="mt-3 text-sm text-ink-600">
          Break-glass is restricted to registered clinicians. Sign in with your
          hospital email — a secure wallet is created for you, no seed phrase.
        </p>
        <button
          onClick={login}
          className="mt-6 w-full rounded-xl bg-vital px-5 py-4 font-bold text-ink-950"
        >
          Sign in
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-[0.2em] text-ink-600 uppercase">
          Provider console
        </span>
        <span className="text-[11px] text-ink-600">{user?.email?.address}</span>
      </div>

      <h1 className="mt-4 text-2xl font-bold text-white">Break glass</h1>
      <p className="mt-2 text-xs break-all text-ink-600">
        Patient <span className="text-info">{patientId}</span> · {patientHash.slice(0, 18)}…
      </p>

      {!hasWallet && (
        <p className="mt-4 rounded-lg bg-caution/10 p-3 text-xs text-caution">
          Preparing your secure wallet… if this persists, reload once.
        </p>
      )}

      {phase === "idle" || phase === "error" ? (
        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs font-semibold text-ink-600">Reason for access</span>
            <select
              value={reason}
              onChange={(e) => setReason(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-3 text-sm text-white"
            >
              <option value={REASON_CODES.UNCONSCIOUS}>Unconscious patient</option>
              <option value={REASON_CODES.TRAUMA}>Trauma / RTA</option>
              <option value={REASON_CODES.CARDIAC}>Cardiac event</option>
              <option value={REASON_CODES.OVERDOSE}>Suspected overdose</option>
              <option value={REASON_CODES.OTHER}>Other emergency</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-ink-600">
              Clinical context (optional — its hash is anchored on-chain)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="male ~35, RTA, GCS 9, BP 90/60"
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white"
            />
          </label>

          <button
            onClick={breakGlass}
            disabled={!hasWallet}
            className="w-full rounded-xl bg-critical px-5 py-5 text-lg font-black tracking-wide text-white uppercase disabled:opacity-40"
          >
            🔴 Break glass
          </button>
          <p className="text-center text-[11px] text-ink-600">
            This access is permanent, attributable to you, and visible to the
            patient in real time.
          </p>
        </div>
      ) : null}

      {trace.length > 0 && (
        <ol className="mt-6 space-y-2 border-l border-ink-700 pl-4">
          {trace.map((entry, i) => (
            <li key={i} className="text-sm">
              <span
                className={
                  entry.tone === "ok"
                    ? "text-vital"
                    : entry.tone === "warn"
                      ? "text-caution"
                      : entry.tone === "chain"
                        ? "text-info"
                        : "text-ink-600"
                }
              >
                {entry.text}
              </span>
              {entry.href && (
                <a
                  href={entry.href}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 text-info underline"
                >
                  view on Basescan ↗
                </a>
              )}
            </li>
          ))}
        </ol>
      )}

      {record && <RecordView record={record} />}
    </Shell>
  );
}

function RecordView({ record }: { record: Tier1Record }) {
  return (
    <div className="mt-8 rounded-2xl border border-vital/30 bg-ink-900 p-5">
      <p className="text-xs font-semibold tracking-widest text-vital uppercase">
        Tier 1 · clinical record
      </p>
      <h2 className="mt-2 text-xl font-bold text-white">{record.name}</h2>
      <p className="text-sm text-ink-600">
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
        <p className="mt-4 rounded-lg bg-caution/10 p-3 text-sm text-caution">{record.notes}</p>
      )}
    </div>
  );
}

function Section({ title, items, alarming }: { title: string; items: string[]; alarming?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-[11px] font-semibold tracking-widest text-ink-600 uppercase">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className={`text-sm ${alarming ? "font-semibold text-critical" : "text-white"}`}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-dvh w-full max-w-md px-5 py-10">{children}</main>;
}

export default function BreakGlassPage() {
  return (
    <Suspense fallback={<Shell><p className="text-ink-600">Loading…</p></Shell>}>
      <BreakGlassInner />
    </Suspense>
  );
}
