"use client";

import { useCallback, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { sealRecord } from "@lifescan/crypto";
import {
  ACCESS_LOG_ABI,
  CHAIN,
  explorerTx,
  patientHash as toPatientHash,
  publicClient,
  requireAddress,
} from "@/lib/contracts";
import { distributeShares, guardianEndpoints } from "@/lib/guardians";
import { useProviderWallet } from "@/lib/useProviderWallet";
import { buildTier0 } from "@/lib/tier0";
import { DEMO_PATIENT_ID, DEMO_RECORD } from "@/lib/record";
import { Wordmark, Eyebrow, PageShell } from "@/components/ui";
import { FundButton } from "@/components/FundButton";
import { Collapsible } from "@/components/Collapsible";

/**
 * The patient side: seal a clinical record and issue a card.
 *
 * Sealing happens entirely in this browser — the plaintext record never leaves
 * the device. What leaves is ciphertext (to the mirror) and one Shamir share to
 * each Guardian. The patient claims their record hash on-chain themselves, so
 * they, and only they, can later freeze it.
 *
 * For the exhibition this issues the seeded demo patient; the same flow backs a
 * public "create your card" form, which is the post-hackathon product.
 */

type Phase = "idle" | "sealing" | "done" | "error";

export default function PatientPage() {
  const { ready, authenticated, login } = usePrivy();
  const { address, getWalletClient, hasWallet } = useProviderWallet();

  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<string[]>([]);
  const [cardUrl, setCardUrl] = useState<string>("");
  const [error, setError] = useState<string>("");

  const patientId = DEMO_PATIENT_ID;
  const patientHash = toPatientHash(patientId);

  const step = (text: string) => setSteps((s) => [...s, text]);

  const seal = useCallback(async () => {
    setSteps([]);
    setError("");
    setPhase("sealing");

    try {
      if (guardianEndpoints().length === 0) {
        throw new Error("No Guardians configured (NEXT_PUBLIC_GUARDIAN_URLS).");
      }

      // Idempotent resume: if this patient's record is already mirrored, a
      // previous run already encrypted, mirrored and distributed the shares
      // (the guardians refuse to overwrite, so re-encrypting now would desync
      // the shares from the ciphertext). Skip straight to the on-chain claim —
      // this is exactly the case where the first attempt failed only for gas.
      const existing = await fetch(`/api/records?hash=${patientHash}`);
      const alreadySealed = existing.ok;

      if (alreadySealed) {
        step("Record already sealed and shares distributed — resuming to claim.");
      } else {
        // 1. Encrypt + split, in the browser.
        step("Encrypting record and splitting the key 2-of-3…");
        const sealed = await sealRecord(DEMO_RECORD);

        // 2. Mirror the ciphertext (which no server can read).
        step("Mirroring encrypted record…");
        const mirror = await fetch("/api/records", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            patientHash,
            ciphertext: sealed.ciphertext,
            label: `${DEMO_RECORD.name} · ${DEMO_RECORD.bloodGroup}`,
          }),
        });
        if (!mirror.ok) throw new Error("Failed to mirror the encrypted record.");

        // 3. One share to each Guardian.
        step("Distributing one key share to each Guardian…");
        await distributeShares(patientHash, sealed.shares);
      }

      // 4. Claim the record hash on-chain — this is what makes freeze possible.
      step("Claiming your record on-chain (so only you can freeze it)…");
      const wallet = await getWalletClient();
      const owner = await publicClient().readContract({
        address: requireAddress("accessLog"),
        abi: ACCESS_LOG_ABI,
        functionName: "ownerOf",
        args: [patientHash],
      });

      if (owner === "0x0000000000000000000000000000000000000000") {
        const txHash = await wallet.writeContract({
          address: requireAddress("accessLog"),
          abi: ACCESS_LOG_ABI,
          functionName: "registerPatient",
          args: [patientHash],
          account: address!,
          chain: CHAIN,
        });
        await publicClient().waitForTransactionReceipt({ hash: txHash });
        step(`Record claimed · ${explorerTx(txHash)}`);
      } else {
        step("Record already claimed on-chain — skipped.");
      }

      // 5. Produce the card payload (Tier 0 in the fragment).
      const fragment = buildTier0({
        name: DEMO_RECORD.name,
        bloodGroup: DEMO_RECORD.bloodGroup,
        allergies: DEMO_RECORD.allergies.map((a) => a.substance),
        flags: ["PACEMAKER", "ANTICOAGULANT"],
        emergencyContact: DEMO_RECORD.emergencyContacts[0]?.phone ?? "",
      });
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setCardUrl(`${origin}/s/${patientId}#${fragment}`);

      step("Done. The card is ready to write to an NFC tag.");
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setPhase("error");
    }
  }, [address, getWalletClient, patientHash]);

  if (!ready)
    return (
      <PageShell>
        <p className="text-muted">Loading…</p>
      </PageShell>
    );

  if (!authenticated) {
    return (
      <PageShell>
        <Wordmark />
        <h1 className="mt-9 text-2xl font-bold text-text">Your LifeScan card</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Sign in to seal your medical record and issue a card. Your record is
          encrypted on this device before anything leaves it.
        </p>
        <button onClick={login} className="btn btn-vital btn-block mt-6">
          Sign in
        </button>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Wordmark />
      <div className="mt-8 rise">
        <Eyebrow>Patient · issue card</Eyebrow>
        <h1 className="mt-2 text-2xl font-bold text-text">{DEMO_RECORD.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {DEMO_RECORD.bloodGroup} · {DEMO_RECORD.allergies[0]?.substance} allergy · pacemaker
        </p>
        {address && (
          <p className="mt-2 font-mono text-[11px] break-all text-faint">wallet {address}</p>
        )}
        {address && <FundButton address={address} />}
      </div>

      {phase === "idle" || phase === "error" ? (
        <button onClick={seal} disabled={!hasWallet} className="btn btn-vital btn-block mt-6">
          Seal record &amp; issue card
        </button>
      ) : null}

      {steps.length > 0 && (
        <div className="mt-6">
          <Collapsible
            title="Seal progress"
            live={phase === "sealing"}
            meta={<span className="text-[11px] text-faint tnum">{steps.length}</span>}
            defaultOpen
          >
            <ol className="space-y-3 pt-1">
              {steps.map((s, i) => {
                const last = i === steps.length - 1;
                const working = phase === "sealing" && last;
                return (
                  <li key={i} className="flex gap-3 text-sm">
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${working ? "bg-vital live-dot" : "bg-vital"}`}
                      style={!working && phase === "sealing" ? { background: "var(--faint)" } : undefined}
                    />
                    <span className={last && phase !== "sealing" ? "text-text" : "text-muted"}>{s}</span>
                  </li>
                );
              })}
            </ol>
          </Collapsible>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-xl border border-critical/30 bg-critical/10 p-3 text-sm text-critical">
          {error}
        </p>
      )}

      {cardUrl && (
        <div
          className="card mt-6 p-4 rise"
          style={{ borderColor: "color-mix(in srgb, var(--vital) 30%, transparent)" }}
        >
          <Eyebrow className="!text-vital">Card payload</Eyebrow>
          <p className="mt-2 font-mono text-xs break-all text-muted">{cardUrl}</p>
          <a href={cardUrl} className="link mt-3 inline-block text-sm">
            Preview the scan →
          </a>
        </div>
      )}

      <a href="/patient/audit" className="card mt-6 block px-5 py-4 transition hover:border-line-strong">
        <span className="block text-sm font-semibold text-text">Your access log →</span>
        <span className="mt-0.5 block text-xs text-muted">
          See who broke glass, freeze the record, or revoke a provider.
        </span>
      </a>

      <a href="/patient/new" className="card mt-3 block px-5 py-4 transition hover:border-line-strong">
        <span className="block text-sm font-semibold text-text">Create a real patient card →</span>
        <span className="mt-0.5 block text-xs text-muted">
          Enter your own details instead of the demo patient — same encryption pipeline.
        </span>
      </a>
    </PageShell>
  );
}
