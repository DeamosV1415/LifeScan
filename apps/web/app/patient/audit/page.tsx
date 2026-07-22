"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  ACCESS_LOG_ABI,
  CHAIN,
  explorerAddress,
  explorerTx,
  patientHash as toPatientHash,
  publicClient,
  reasonLabel,
  requireAddress,
} from "@/lib/contracts";
import { useProviderWallet } from "@/lib/useProviderWallet";
import { DEMO_PATIENT_ID } from "@/lib/record";

/**
 * The patient's audit view — the accountability half of the pitch, made visible.
 *
 * It reads the on-chain access history the moment a clinician breaks glass, so
 * the patient watches access appear in real time. Then the two controls the
 * chain actually enforces: Freeze (a kill switch for the whole record) and
 * Revoke (block one provider). After either, the next break-glass fails — not in
 * our UI, but in the contract the Guardians independently re-check.
 */

interface Access {
  provider: `0x${string}`;
  timestamp: bigint;
  reasonCode: number;
  contextHash: `0x${string}`;
}

export default function PatientAuditPage() {
  const { ready, authenticated, login } = usePrivy();
  const { address, getWalletClient, hasWallet } = useProviderWallet();

  const patientId = DEMO_PATIENT_ID;
  const patientHash = toPatientHash(patientId);

  const [history, setHistory] = useState<Access[]>([]);
  const [frozen, setFrozen] = useState(false);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [owner, setOwner] = useState<`0x${string}` | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; href?: string } | null>(null);

  const refresh = useCallback(async () => {
    const client = publicClient();
    const accessLog = requireAddress("accessLog");
    const [rawHistory, isFrozen, ownerAddr] = await Promise.all([
      client.readContract({ address: accessLog, abi: ACCESS_LOG_ABI, functionName: "getAccessHistory", args: [patientHash] }),
      client.readContract({ address: accessLog, abi: ACCESS_LOG_ABI, functionName: "isFrozen", args: [patientHash] }),
      client.readContract({ address: accessLog, abi: ACCESS_LOG_ABI, functionName: "ownerOf", args: [patientHash] }),
    ]);

    const accesses = [...(rawHistory as Access[])].reverse(); // newest first
    setHistory(accesses);
    setFrozen(Boolean(isFrozen));
    setOwner(ownerAddr as `0x${string}`);

    // Which providers are individually blocked (for the per-row label).
    const uniqueProviders = [...new Set(accesses.map((a) => a.provider.toLowerCase()))];
    const flags = await Promise.all(
      uniqueProviders.map((p) =>
        client.readContract({ address: accessLog, abi: ACCESS_LOG_ABI, functionName: "isBlocked", args: [patientHash, p as `0x${string}`] }),
      ),
    );
    setBlocked(new Set(uniqueProviders.filter((_, i) => flags[i])));
  }, [patientHash]);

  // Live: poll every 4s so an on-stage break-glass shows up on its own.
  useEffect(() => {
    if (!authenticated) return;
    refresh().catch(() => {});
    const id = setInterval(() => refresh().catch(() => {}), 4000);
    return () => clearInterval(id);
  }, [authenticated, refresh]);

  const freeze = useCallback(async () => {
    setBusy("freeze");
    setNote(null);
    try {
      const wallet = await getWalletClient();
      const tx = await wallet.writeContract({
        address: requireAddress("accessLog"),
        abi: ACCESS_LOG_ABI,
        functionName: "freezeRecord",
        args: [patientHash],
        account: address!,
        chain: CHAIN,
      });
      await publicClient().waitForTransactionReceipt({ hash: tx });
      setNote({ text: "Record frozen. Every future break-glass now fails on-chain.", href: explorerTx(tx) });
      await refresh();
    } catch (e) {
      setNote({ text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }, [address, getWalletClient, patientHash, refresh]);

  const unfreeze = useCallback(async () => {
    setBusy("unfreeze");
    setNote(null);
    try {
      const wallet = await getWalletClient();
      const tx = await wallet.writeContract({
        address: requireAddress("accessLog"),
        abi: ACCESS_LOG_ABI,
        functionName: "unfreezeRecord",
        args: [patientHash],
        account: address!,
        chain: CHAIN,
      });
      await publicClient().waitForTransactionReceipt({ hash: tx });
      setNote({ text: "Record un-frozen (demo reset).", href: explorerTx(tx) });
      await refresh();
    } catch (e) {
      setNote({ text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }, [address, getWalletClient, patientHash, refresh]);

  const revoke = useCallback(
    async (provider: `0x${string}`) => {
      setBusy(provider);
      setNote(null);
      try {
        const wallet = await getWalletClient();
        const tx = await wallet.writeContract({
          address: requireAddress("accessLog"),
          abi: ACCESS_LOG_ABI,
          functionName: "blockProvider",
          args: [patientHash, provider],
          account: address!,
          chain: CHAIN,
        });
        await publicClient().waitForTransactionReceipt({ hash: tx });
        setNote({ text: "Provider revoked. Their next break-glass will be refused.", href: explorerTx(tx) });
        await refresh();
      } catch (e) {
        setNote({ text: friendlyError(e) });
      } finally {
        setBusy(null);
      }
    },
    [address, getWalletClient, patientHash, refresh],
  );

  if (!ready) return <Shell><p className="text-ink-600">Loading…</p></Shell>;

  if (!authenticated) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold text-white">Your access log</h1>
        <p className="mt-3 text-sm text-ink-600">
          Sign in with the email you used to issue your card. Only you — the
          record&apos;s on-chain owner — can freeze it or revoke a provider.
        </p>
        <button onClick={login} className="mt-6 w-full rounded-xl bg-vital px-5 py-4 font-bold text-ink-950">
          Sign in
        </button>
      </Shell>
    );
  }

  const isOwner =
    owner !== null &&
    address !== undefined &&
    owner.toLowerCase() === address.toLowerCase();

  return (
    <Shell>
      <span className="text-xs font-semibold tracking-[0.2em] text-ink-600 uppercase">
        Patient · access log
      </span>
      <div className="mt-3 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Who touched my record</h1>
        <span className="flex items-center gap-1.5 text-xs text-ink-600">
          <span className="size-2 animate-pulse rounded-full bg-vital" /> live
        </span>
      </div>
      <p className="mt-1 text-xs break-all text-ink-600">
        {patientId} · {patientHash.slice(0, 18)}…
      </p>

      {frozen && (
        <div className="mt-4 rounded-xl border border-critical/40 bg-critical/10 p-4">
          <p className="text-sm font-bold text-critical">🔒 Record frozen</p>
          <p className="mt-1 text-xs text-ink-600">
            Every break-glass is refused on-chain — enforced by the contract, not
            this screen.
          </p>
        </div>
      )}

      {!frozen && (
        <button
          onClick={freeze}
          disabled={!hasWallet || busy !== null}
          className="mt-5 w-full rounded-xl bg-critical px-5 py-4 font-black tracking-wide text-white uppercase disabled:opacity-40"
        >
          {busy === "freeze" ? "Freezing…" : "🔒 Freeze my record"}
        </button>
      )}
      {frozen && (
        <button
          onClick={unfreeze}
          disabled={!hasWallet || busy !== null}
          className="mt-5 w-full rounded-xl border border-ink-700 px-5 py-3 text-sm font-semibold text-ink-600 disabled:opacity-40"
        >
          {busy === "unfreeze" ? "Un-freezing…" : "Un-freeze (demo reset)"}
        </button>
      )}

      {note && (
        <p className="mt-4 rounded-lg bg-ink-900 p-3 text-sm text-info">
          {note.text}
          {note.href && (
            <a href={note.href} target="_blank" rel="noreferrer" className="ml-2 underline">
              view ↗
            </a>
          )}
        </p>
      )}

      {authenticated && owner !== null && !isOwner && (
        <p className="mt-4 rounded-lg bg-caution/10 p-3 text-xs text-caution">
          This record is owned by a different wallet ({owner.slice(0, 10)}…), so
          freeze/revoke will be refused on-chain. Sign in with the wallet that
          issued the card.
        </p>
      )}

      <section className="mt-6">
        <p className="text-[11px] font-semibold tracking-widest text-ink-600 uppercase">
          Access history · on-chain
        </p>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-ink-600">
            No access yet. This list fills the instant a clinician breaks glass.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {history.map((a, i) => {
              const isBlocked = blocked.has(a.provider.toLowerCase());
              return (
                <li key={`${a.provider}-${a.timestamp}-${i}`} className="rounded-xl border border-ink-800 bg-ink-900 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{reasonLabel(a.reasonCode)}</p>
                      <p className="mt-0.5 text-xs text-ink-600">{timeAgo(a.timestamp)}</p>
                      <a
                        href={explorerAddress(a.provider)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block font-mono text-[11px] text-info underline"
                      >
                        {a.provider.slice(0, 10)}…{a.provider.slice(-6)}
                      </a>
                    </div>
                    {isBlocked ? (
                      <span className="shrink-0 rounded-full bg-critical/15 px-3 py-1 text-[11px] font-bold text-critical">
                        Revoked
                      </span>
                    ) : (
                      <button
                        onClick={() => revoke(a.provider)}
                        disabled={!hasWallet || busy !== null || frozen}
                        className="shrink-0 rounded-full border border-critical/50 px-3 py-1 text-[11px] font-bold text-critical disabled:opacity-40"
                      >
                        {busy === a.provider ? "Revoking…" : "Revoke"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Shell>
  );
}

function timeAgo(timestamp: bigint): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(timestamp));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/NotPatientOwner/.test(msg)) return "Refused on-chain: only the record owner can do this.";
  if (/PatientNotRegistered/.test(msg)) return "This record has not been claimed on-chain yet.";
  if (/User rejected|denied/i.test(msg)) return "Transaction cancelled.";
  return msg;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-dvh w-full max-w-md px-5 py-10">{children}</main>;
}
