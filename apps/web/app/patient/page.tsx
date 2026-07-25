"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { usePatientCards, type PatientCard } from "@/lib/patient-cards";
import {
  ACCESS_LOG_ABI,
  explorerAddress,
  patientHash as toPatientHash,
  publicClient,
  requireAddress,
  shortAddress,
} from "@/lib/contracts";
import { Wordmark, Eyebrow, PageShell, DemoTag } from "@/components/ui";
import { CopyButton } from "@/components/CopyButton";

/**
 * The patient hub — every card this login owns.
 *
 * The seeded demo patient (tagged) plus every card issued under this email, all
 * from one shared source (usePatientCards). Cards are view-only here: copy the
 * URL or id, jump to the on-chain access log, or hand a provider the break-glass
 * link. New cards — and the client-side seal/encryption — happen on /patient/new.
 */
export default function PatientPage() {
  const { ready, authenticated, login, user } = usePrivy();
  const email = user?.email?.address ?? "";
  const { cards, loading } = usePatientCards(email);

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
        <h1 className="mt-9 text-2xl font-bold text-text">Your LifeScan cards</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Sign in with the email you used to issue your cards. Your records are
          encrypted on your device before anything leaves it.
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
        <Eyebrow>Patient · your cards</Eyebrow>
        <h1 className="mt-2 text-2xl font-bold text-text">Your LifeScan cards</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {email ? (
            <>
              Linked to <span className="text-text">{email}</span> — they follow
              your login across browsers and devices.
            </>
          ) : (
            "Cards linked to your login."
          )}
        </p>
      </div>

      <section className="mt-6">
        {loading ? (
          <p className="text-sm text-muted">Loading your cards…</p>
        ) : (
          <ul className="space-y-3">
            {cards.map((c) => (
              <PatientCardRow key={c.id} card={c} />
            ))}
          </ul>
        )}
      </section>

      <a href="/patient/new" className="btn btn-vital btn-block mt-7">
        + Create a new card
      </a>
      <p className="mt-2 text-center text-xs text-muted">
        Enter a patient&apos;s details — same client-side encryption pipeline.
      </p>
    </PageShell>
  );
}

function PatientCardRow({ card }: { card: PatientCard }) {
  // The record's on-chain owner — the wallet that claimed it, and the only one
  // that can freeze or revoke it. For your own cards this is your wallet; for
  // the demo card it's whoever first claimed it. Read live so it reflects the
  // chain, not a stored copy.
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    publicClient()
      .readContract({
        address: requireAddress("accessLog"),
        abi: ACCESS_LOG_ABI,
        functionName: "ownerOf",
        args: [toPatientHash(card.id)],
      })
      .then((o) => {
        if (!cancelled) setOwner(o as string);
      })
      .catch(() => {
        /* leave null — the wallet line simply won't render */
      });
    return () => {
      cancelled = true;
    };
  }, [card.id]);

  const ZERO = "0x0000000000000000000000000000000000000000";
  const ownerAddr = owner && owner.toLowerCase() !== ZERO ? owner : null;

  const heading = (
    <p className="flex items-center gap-2 text-sm font-semibold text-text">
      <span>
        {card.name} <span className="text-muted">· {card.bloodGroup}</span>
      </span>
      {card.demo && <DemoTag />}
    </p>
  );

  return (
    <li className="card p-4">
      {card.url ? (
        <a href={card.url} target="_blank" rel="noreferrer" className="group block">
          {heading}
          <p className="mt-0.5 font-mono text-[11px] break-all text-faint">
            id {card.id}
            <span className="ml-1.5 text-info opacity-70 transition-opacity group-hover:opacity-100">
              ↗ preview
            </span>
          </p>
        </a>
      ) : (
        <>
          {heading}
          <p className="mt-0.5 font-mono text-[11px] break-all text-faint">id {card.id}</p>
        </>
      )}
      {ownerAddr ? (
        <p className="mt-1.5 font-mono text-[11px] text-faint">
          wallet{" "}
          <a
            href={explorerAddress(ownerAddr)}
            target="_blank"
            rel="noreferrer"
            className="link"
          >
            {shortAddress(ownerAddr)}
          </a>
        </p>
      ) : owner ? (
        <p className="mt-1.5 text-[11px] text-faint">Wallet: not claimed on-chain yet</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {card.url && <CopyButton text={card.url} label="Copy URL" />}
        <CopyButton text={card.id} label="Copy id" />
        <a href={`/patient/audit?patient=${card.id}`} className="chip chip-muted">
          Access log →
        </a>
        <a href={`/provider/break-glass?patient=${card.id}`} className="chip chip-muted">
          Break glass →
        </a>
      </div>
    </li>
  );
}
