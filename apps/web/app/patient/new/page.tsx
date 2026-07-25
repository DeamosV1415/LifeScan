"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { buildTier0, FLAG_LABELS } from "@/lib/tier0";
import type { Tier1Record } from "@/lib/record";
import { Wordmark, Eyebrow, PageShell } from "@/components/ui";
import { FundButton } from "@/components/FundButton";
import { Collapsible } from "@/components/Collapsible";
import { CopyButton } from "@/components/CopyButton";

/**
 * Create-your-own patient. The same seal → mirror → distribute → claim pipeline
 * the demo patient uses, but fed from a form instead of a hardcoded record, so a
 * real person can issue their own card. Each new patient gets a fresh random id,
 * which derives a unique on-chain hash and a unique card URL.
 */

type Phase = "form" | "sealing" | "done" | "error";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const FLAG_KEYS = Object.keys(FLAG_LABELS);

interface FormState {
  name: string;
  dob: string;
  bloodGroup: string;
  conditions: string[];
  medications: { name: string; dose: string; frequency: string }[];
  allergies: { substance: string; reaction: string; severity: string }[];
  implants: { type: string; model: string }[];
  flags: string[];
  emergencyContacts: { name: string; relation: string; phone: string }[];
  insurance: { provider: string; policyNo: string; sumInsured: string };
  notes: string;
}

const EMPTY: FormState = {
  name: "",
  dob: "",
  bloodGroup: "",
  conditions: [""],
  medications: [{ name: "", dose: "", frequency: "" }],
  allergies: [{ substance: "", reaction: "", severity: "severe" }],
  implants: [{ type: "", model: "" }],
  flags: [],
  emergencyContacts: [{ name: "", relation: "", phone: "" }],
  insurance: { provider: "", policyNo: "", sumInsured: "" },
  notes: "",
};

export default function NewPatientPage() {
  const { ready, authenticated, login, user } = usePrivy();
  const email = user?.email?.address ?? "";
  const { address, getWalletClient, hasWallet } = useProviderWallet();

  // A fresh unique id for this patient, generated on the client only. Doing this
  // in a memo would run during SSR too and produce a different value than the
  // client hydration — a hydration mismatch. Generating it in an effect keeps
  // the server and first client render identical (empty), then fills it in.
  const [patientId, setPatientId] = useState("");
  useEffect(() => {
    setPatientId(`p-${crypto.randomUUID().slice(0, 8)}`);
  }, []);
  const patientHash = useMemo<`0x${string}`>(
    () => (patientId ? toPatientHash(patientId) : "0x"),
    [patientId],
  );

  const [f, setF] = useState<FormState>(EMPTY);
  const [phase, setPhase] = useState<Phase>("form");
  const [steps, setSteps] = useState<string[]>([]);
  const [cardUrl, setCardUrl] = useState("");
  const [error, setError] = useState("");

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setF((prev) => ({ ...prev, [key]: value }));
  const step = (text: string) => setSteps((s) => [...s, text]);

  const canSubmit = f.name.trim() !== "" && f.bloodGroup !== "" && hasWallet && patientId !== "";

  const seal = useCallback(async () => {
    setSteps([]);
    setError("");
    setPhase("sealing");
    try {
      if (guardianEndpoints().length === 0) {
        throw new Error("No Guardians configured (NEXT_PUBLIC_GUARDIAN_URLS).");
      }

      const record: Tier1Record = {
        name: f.name.trim(),
        dob: f.dob.trim(),
        bloodGroup: f.bloodGroup,
        conditions: f.conditions.map((c) => c.trim()).filter(Boolean),
        medications: f.medications.filter((m) => m.name.trim()),
        allergies: f.allergies.filter((a) => a.substance.trim()),
        implants: f.implants
          .filter((i) => i.type.trim())
          .map((i) => ({ type: i.type.trim(), model: i.model.trim() || undefined })),
        emergencyContacts: f.emergencyContacts.filter((c) => c.phone.trim() || c.name.trim()),
        insurance:
          f.insurance.provider.trim() || f.insurance.policyNo.trim() || f.insurance.sumInsured.trim()
            ? f.insurance
            : undefined,
        notes: f.notes.trim() || undefined,
      };

      // Idempotent resume (same guard the demo seal uses): if this id is already
      // mirrored, skip re-encrypting and go straight to the on-chain claim.
      const existing = await fetch(`/api/records?hash=${patientHash}`);
      if (existing.ok) {
        step("Record already sealed and shares distributed — resuming to claim.");
      } else {
        step("Encrypting record and splitting the key 2-of-3…");
        const sealed = await sealRecord(record);

        step("Mirroring encrypted record…");
        const mirror = await fetch("/api/records", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            patientHash,
            ciphertext: sealed.ciphertext,
            label: `${record.name} · ${record.bloodGroup}`,
          }),
        });
        if (!mirror.ok) throw new Error("Failed to mirror the encrypted record.");

        step("Distributing one key share to each Guardian…");
        await distributeShares(patientHash, sealed.shares);
      }

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

      const fragment = buildTier0({
        name: record.name,
        bloodGroup: record.bloodGroup,
        allergies: record.allergies.map((a) => a.substance),
        flags: f.flags,
        emergencyContact: record.emergencyContacts[0]?.phone ?? "",
      });
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const url = `${origin}/s/${patientId}#${fragment}`;
      setCardUrl(url);

      // Register the card against the login email so it appears on the patient
      // hub (/patient) in any browser this account signs into.
      if (email) {
        fetch("/api/my-cards", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email,
            card: { id: patientId, name: record.name, bloodGroup: record.bloodGroup, url, createdAt: Date.now() },
          }),
        }).catch(() => {});
      }

      step("Done. The card is ready to write to an NFC tag.");
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setPhase("error");
    }
  }, [f, address, getWalletClient, patientHash, patientId, email]);

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
        <h1 className="mt-9 text-2xl font-bold text-text">Create your LifeScan card</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Sign in to enter your details and issue a card. Your record is encrypted
          on this device before anything leaves it — the server only ever holds
          ciphertext it cannot read.
        </p>
        <button onClick={login} className="btn btn-vital btn-block mt-6">
          Sign in
        </button>
      </PageShell>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-5 py-10 sm:px-6">
      <Wordmark />
      <div className="mt-8">
        <Eyebrow>Patient · create card</Eyebrow>
        <h1 className="mt-2 text-2xl font-bold text-text">Your medical profile</h1>
        <p className="mt-1 font-mono text-[11px] text-faint">
          id {patientId} · {patientHash.slice(0, 14)}…
        </p>
      </div>

      {address && <FundButton address={address} />}

      {phase === "form" || phase === "error" ? (
        <div className="mt-8 space-y-8">
          {/* Identity + card data */}
          <Card title="Identity & card data" hint="Blood group and allergies also print on the offline card.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name" required value={f.name} onChange={(v) => set("name", v)} placeholder="Ramesh Kumar" />
              <Field label="Date of birth" value={f.dob} onChange={(v) => set("dob", v)} placeholder="1989-03-14" type="date" />
            </div>
            <label className="mt-3 block">
              <span className="eyebrow mb-1.5 block">Blood group *</span>
              <select value={f.bloodGroup} onChange={(e) => set("bloodGroup", e.target.value)} className="input">
                <option value="">Select…</option>
                {BLOOD_GROUPS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </label>
            <div className="mt-3">
              <span className="eyebrow mb-1.5 block">Card flags (implants & directives)</span>
              <div className="flex flex-wrap gap-2">
                {FLAG_KEYS.map((key) => {
                  const on = f.flags.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        set("flags", on ? f.flags.filter((k) => k !== key) : [...f.flags, key])
                      }
                      className={`chip ${on ? "chip-implant" : "chip-muted"}`}
                      title={FLAG_LABELS[key].caution}
                    >
                      {FLAG_LABELS[key].label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* Allergies */}
          <Card title="Allergies" hint="Substance, reaction and severity. Substance names print on the card.">
            <RowList
              rows={f.allergies}
              onChange={(rows) => set("allergies", rows)}
              blank={{ substance: "", reaction: "", severity: "severe" }}
              render={(row, upd) => (
                <div className="grid gap-2 sm:grid-cols-3">
                  <input className="input" placeholder="Penicillin" value={row.substance} onChange={(e) => upd({ substance: e.target.value })} />
                  <input className="input" placeholder="Anaphylaxis" value={row.reaction} onChange={(e) => upd({ reaction: e.target.value })} />
                  <select className="input" value={row.severity} onChange={(e) => upd({ severity: e.target.value })}>
                    <option value="mild">mild</option>
                    <option value="moderate">moderate</option>
                    <option value="severe">severe</option>
                  </select>
                </div>
              )}
            />
          </Card>

          {/* Conditions */}
          <Card title="Conditions">
            <RowList
              rows={f.conditions}
              onChange={(rows) => set("conditions", rows)}
              blank=""
              render={(row, _upd, i) => (
                <input
                  className="input"
                  placeholder="Type 2 diabetes mellitus"
                  value={row}
                  onChange={(e) => {
                    const next = [...f.conditions];
                    next[i] = e.target.value;
                    set("conditions", next);
                  }}
                />
              )}
            />
          </Card>

          {/* Medications */}
          <Card title="Medications">
            <RowList
              rows={f.medications}
              onChange={(rows) => set("medications", rows)}
              blank={{ name: "", dose: "", frequency: "" }}
              render={(row, upd) => (
                <div className="grid gap-2 sm:grid-cols-3">
                  <input className="input" placeholder="Warfarin" value={row.name} onChange={(e) => upd({ name: e.target.value })} />
                  <input className="input" placeholder="5 mg" value={row.dose} onChange={(e) => upd({ dose: e.target.value })} />
                  <input className="input" placeholder="once daily" value={row.frequency} onChange={(e) => upd({ frequency: e.target.value })} />
                </div>
              )}
            />
          </Card>

          {/* Implants */}
          <Card title="Implants">
            <RowList
              rows={f.implants}
              onChange={(rows) => set("implants", rows)}
              blank={{ type: "", model: "" }}
              render={(row, upd) => (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className="input" placeholder="Pacemaker" value={row.type} onChange={(e) => upd({ type: e.target.value })} />
                  <input className="input" placeholder="Medtronic Azure XT DR" value={row.model} onChange={(e) => upd({ model: e.target.value })} />
                </div>
              )}
            />
          </Card>

          {/* Emergency contacts */}
          <Card title="Emergency contacts" hint="The first number is the one the agent notifies and that prints on the card.">
            <RowList
              rows={f.emergencyContacts}
              onChange={(rows) => set("emergencyContacts", rows)}
              blank={{ name: "", relation: "", phone: "" }}
              render={(row, upd) => (
                <div className="grid gap-2 sm:grid-cols-3">
                  <input className="input" placeholder="Sunita Kumar" value={row.name} onChange={(e) => upd({ name: e.target.value })} />
                  <input className="input" placeholder="spouse" value={row.relation} onChange={(e) => upd({ relation: e.target.value })} />
                  <input className="input" placeholder="+9198…" value={row.phone} onChange={(e) => upd({ phone: e.target.value })} />
                </div>
              )}
            />
          </Card>

          {/* Insurance + notes */}
          <Card title="Insurance & notes" hint="Optional. Sum insured feeds the agent's pre-authorisation packet.">
            <div className="grid gap-2 sm:grid-cols-3">
              <input className="input" placeholder="Provider · Star Health" value={f.insurance.provider} onChange={(e) => set("insurance", { ...f.insurance, provider: e.target.value })} />
              <input className="input" placeholder="Policy no." value={f.insurance.policyNo} onChange={(e) => set("insurance", { ...f.insurance, policyNo: e.target.value })} />
              <input className="input" placeholder="Sum insured · ₹5,00,000" value={f.insurance.sumInsured} onChange={(e) => set("insurance", { ...f.insurance, sumInsured: e.target.value })} />
            </div>
            <textarea
              className="input mt-2 resize-none"
              rows={2}
              placeholder="e.g. Anticoagulated — high bleeding risk. Confirm pacemaker before any MRI."
              value={f.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Card>

          <div className="pt-2">
            <button onClick={seal} disabled={!canSubmit} className="btn btn-vital btn-block">
              Seal record &amp; issue card
            </button>
            {!canSubmit && (
              <p className="mt-2 text-center text-[11px] text-faint">
                Name and blood group are required{!hasWallet ? " · preparing your wallet…" : ""}.
              </p>
            )}
          </div>
        </div>
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
        <p className="mt-4 rounded-xl border border-critical/30 bg-critical/10 p-3 text-sm text-critical">{error}</p>
      )}

      {cardUrl && phase === "done" && (
        <div
          className="card mt-6 overflow-hidden rise"
          style={{ borderColor: "color-mix(in srgb, var(--vital) 35%, transparent)" }}
        >
          <div
            className="flex items-center gap-3 border-b border-line px-5 py-4"
            style={{ background: "color-mix(in srgb, var(--vital) 9%, transparent)" }}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-vital/20 text-vital">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-5">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="eyebrow !text-vital">Card issued</p>
              <p className="truncate text-base font-bold text-text">
                {f.name.trim()} <span className="text-muted">· {f.bloodGroup}</span>
              </p>
            </div>
          </div>

          <div className="space-y-4 p-5">
            <div>
              <span className="eyebrow">Card URL</span>
              <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-[var(--field)] p-2 pl-3">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{cardUrl}</code>
                <CopyButton text={cardUrl} className="shrink-0" />
              </div>
            </div>

            {address && (
              <div>
                <span className="eyebrow">Owner wallet</span>
                <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-[var(--field)] p-2 pl-3">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{address}</code>
                  <CopyButton text={address} className="shrink-0" />
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <a href={cardUrl} className="btn btn-vital flex-1">Preview the scan →</a>
              <a
                href={`/provider/break-glass?patient=${patientId}`}
                className="btn btn-ghost flex-1"
              >
                Break glass →
              </a>
            </div>

            <p className="text-[11px] leading-relaxed text-faint">
              Write this URL to an NFC tag to make a physical card. It&apos;s also
              saved to <a href="/patient" className="link">Your cards</a>, linked to
              your login.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <p className="text-sm font-semibold text-text">{title}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-1.5 block">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        type={type}
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * A small add/remove list of identical rows. `render` draws one row and gets an
 * `upd` helper that shallow-merges into that row (for object rows).
 */
function RowList<T>({
  rows,
  onChange,
  blank,
  render,
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  blank: T;
  render: (row: T, upd: (patch: Partial<T>) => void, index: number) => React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1">
            {render(
              row,
              (patch) => {
                const next = [...rows];
                next[i] = (
                  typeof row === "object" && row !== null ? { ...row, ...patch } : patch
                ) as T;
                onChange(next);
              },
              i,
            )}
          </div>
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="mt-1 shrink-0 rounded-lg border border-line px-2.5 py-2 text-xs text-muted transition hover:border-critical/50 hover:text-critical"
              aria-label="Remove row"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, structuredClone(blank)])}
        className="text-xs font-medium text-info hover:underline"
      >
        + Add
      </button>
    </div>
  );
}
