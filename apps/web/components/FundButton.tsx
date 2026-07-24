"use client";

import { useCallback, useEffect, useState } from "react";
import { publicClient, explorerTx } from "@/lib/contracts";

/**
 * One-click testnet top-up for the signed-in Privy wallet.
 *
 * Privy wallets start empty, so a patient can't claim and a provider can't
 * break glass until theirs holds a little gas. This checks the balance and,
 * when it's low, offers a button that funds the wallet from the deployer via
 * /api/faucet — no address copying, no CLI. It hides itself once funded.
 */

const LOW_THRESHOLD = 500_000_000_000_000n; // 0.0005 ETH — matches the faucet's skip threshold

export function FundButton({ address, onFunded }: { address: `0x${string}`; onFunded?: () => void }) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; href?: string; tone: "ok" | "err" } | null>(null);

  const check = useCallback(async () => {
    try {
      setBalance(await publicClient().getBalance({ address }));
    } catch {
      /* leave balance null; the button still lets them try */
    }
  }, [address]);

  useEffect(() => {
    check();
  }, [check]);

  const fund = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "faucet failed");
      setMsg({
        text: data.already ? "Wallet already has gas — you're good." : "Wallet funded. You can transact now.",
        href: data.txHash ? explorerTx(data.txHash) : undefined,
        tone: "ok",
      });
      await check();
      onFunded?.();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "faucet failed", tone: "err" });
    } finally {
      setBusy(false);
    }
  }, [address, check, onFunded]);

  // Once we know the wallet is funded, disappear — unless we're showing a note.
  if (balance !== null && balance >= LOW_THRESHOLD && !msg) return null;

  return (
    <div className="mt-3 rounded-xl border border-caution/30 bg-caution/10 p-3">
      <p className="text-xs text-caution">
        This wallet has no gas yet. Fund it once to claim on-chain (testnet ETH).
      </p>
      <button onClick={fund} disabled={busy} className="btn btn-ghost mt-2 text-sm">
        {busy ? "Funding…" : "⛽ Fund my wallet"}
      </button>
      {msg && (
        <p className={`mt-2 text-xs ${msg.tone === "ok" ? "text-vital" : "text-critical"}`}>
          {msg.text}
          {msg.href && (
            <a href={msg.href} target="_blank" rel="noreferrer" className="ml-2 underline">
              view ↗
            </a>
          )}
        </p>
      )}
    </div>
  );
}
