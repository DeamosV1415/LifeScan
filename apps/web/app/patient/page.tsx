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

  if (!ready) return <Shell><p className="text-ink-600">Loading…</p></Shell>;

  if (!authenticated) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold text-white">Your LifeScan card</h1>
        <p className="mt-3 text-sm text-ink-600">
          Sign in to seal your medical record and issue a card. Your record is
          encrypted on this device before anything leaves it.
        </p>
        <button onClick={login} className="mt-6 w-full rounded-xl bg-vital px-5 py-4 font-bold text-ink-950">
          Sign in
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <span className="text-xs font-semibold tracking-[0.2em] text-ink-600 uppercase">
        Patient · issue card
      </span>
      <h1 className="mt-3 text-2xl font-bold text-white">{DEMO_RECORD.name}</h1>
      <p className="text-sm text-ink-600">
        {DEMO_RECORD.bloodGroup} · {DEMO_RECORD.allergies[0]?.substance} allergy · pacemaker
      </p>

      {phase === "idle" || phase === "error" ? (
        <button
          onClick={seal}
          disabled={!hasWallet}
          className="mt-6 w-full rounded-xl bg-vital px-5 py-4 font-bold text-ink-950 disabled:opacity-40"
        >
          Seal record &amp; issue card
        </button>
      ) : null}

      {steps.length > 0 && (
        <ol className="mt-6 space-y-2 border-l border-ink-700 pl-4">
          {steps.map((s, i) => (
            <li key={i} className="text-sm text-ink-600">{s}</li>
          ))}
        </ol>
      )}

      {error && <p className="mt-4 rounded-lg bg-critical/10 p-3 text-sm text-critical">{error}</p>}

      {cardUrl && (
        <div className="mt-6 rounded-xl border border-vital/30 bg-ink-900 p-4">
          <p className="text-xs font-semibold text-vital uppercase">Card payload</p>
          <p className="mt-2 text-xs break-all text-ink-600">{cardUrl}</p>
          <a href={cardUrl} className="mt-3 inline-block text-sm text-info underline">
            Preview the scan →
          </a>
        </div>
      )}

      <a
        href="/patient/audit"
        className="mt-6 block rounded-xl border border-ink-800 bg-ink-900 px-5 py-4 transition hover:border-ink-700"
      >
        <span className="block text-sm font-bold text-white">Your access log →</span>
        <span className="mt-0.5 block text-xs text-ink-600">
          See who broke glass, freeze the record, or revoke a provider.
        </span>
      </a>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-dvh w-full max-w-md px-5 py-10">{children}</main>;
}
