"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { explorerAddress, explorerTx } from "@/lib/contracts";

/**
 * Hospital admin console — the onboarding surface behind the whole identity
 * model. This is where an address becomes a clinician: a Privy email login
 * mints a wallet with no authority, and only a registration here (bound to an
 * HFR/HPR facility ID) lets it ever break glass.
 *
 * Verification is front-loaded to onboarding and never sits in the golden-hour
 * path. The admin token gates writes; the deployer key signs server-side and
 * never touches the browser (see app/api/admin/providers/route.ts).
 */

interface ProviderRow {
  address: `0x${string}`;
  hfrId: string;
  name: string;
  active: boolean;
  registeredAt: number;
}

interface RegistryState {
  admin: `0x${string}`;
  registry: `0x${string}`;
  writesEnabled: boolean;
  providers: ProviderRow[];
}

const TOKEN_KEY = "lifescan.adminToken";

export default function AdminPage() {
  const [state, setState] = useState<RegistryState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [token, setToken] = useState("");

  const [form, setForm] = useState({ provider: "", hfrId: "", name: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; href?: string; tone: "ok" | "err" } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/providers", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed to load");
      setState(data);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "failed to load registry");
    }
  }, []);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY) ?? "");
    refresh();
    const id = setInterval(refresh, 6000);
    return () => clearInterval(id);
  }, [refresh]);

  const saveToken = useCallback((value: string) => {
    setToken(value);
    localStorage.setItem(TOKEN_KEY, value);
  }, []);

  const act = useCallback(
    async (payload: Record<string, unknown>, key: string, okText: string) => {
      if (!token) {
        setNote({ text: "Enter the admin token to unlock writes.", tone: "err" });
        return;
      }
      setBusy(key);
      setNote(null);
      try {
        const res = await fetch("/api/admin/providers", {
          method: "POST",
          headers: { "content-type": "application/json", "x-admin-token": token },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "request failed");
        setNote({ text: okText, href: data.txHash ? explorerTx(data.txHash) : undefined, tone: "ok" });
        await refresh();
        return true;
      } catch (e) {
        setNote({ text: e instanceof Error ? e.message : "request failed", tone: "err" });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [token, refresh],
  );

  const register = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const ok = await act(
        { action: "register", provider: form.provider.trim(), hfrId: form.hfrId.trim(), name: form.name.trim() },
        "register",
        `Registered ${form.name.trim() || "provider"}. They can now break glass.`,
      );
      if (ok) setForm({ provider: "", hfrId: "", name: "" });
    },
    [act, form],
  );

  const providers = state?.providers ?? [];
  const activeCount = providers.filter((p) => p.active).length;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-5 py-10 sm:px-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded bg-critical text-sm font-black text-white">
            +
          </span>
          <span className="text-sm font-bold tracking-[0.2em] text-white uppercase">
            LifeScan
          </span>
        </Link>
        <span className="rounded-full border border-implant/40 bg-implant/10 px-3 py-1 text-[11px] font-semibold tracking-widest text-implant uppercase">
          Admin
        </span>
      </div>

      <div className="mt-8">
        <span className="text-xs font-semibold tracking-[0.2em] text-ink-600 uppercase">
          Hospital onboarding
        </span>
        <h1 className="mt-2 text-3xl leading-tight font-bold text-white">
          Provider registry
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-600">
          Email is the doorknob; this registry is the lock. A clinician&apos;s
          login mints a wallet with <em>zero</em> authority — only a registration
          here, bound to an HFR facility ID, lets that address ever break glass.
          Verification happens once, at onboarding, never in the emergency path.
        </p>
      </div>

      {/* On-chain summary strip */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Providers" value={String(providers.length)} />
        <Stat label="Active" value={String(activeCount)} tone="vital" />
        <Stat label="Revoked" value={String(providers.length - activeCount)} tone="critical" />
      </div>

      {state && (
        <p className="mt-3 text-[11px] text-ink-600">
          Registry{" "}
          <a href={explorerAddress(state.registry)} target="_blank" rel="noreferrer" className="font-mono text-info underline">
            {state.registry.slice(0, 10)}…{state.registry.slice(-6)}
          </a>{" "}
          · admin{" "}
          <a href={explorerAddress(state.admin)} target="_blank" rel="noreferrer" className="font-mono text-info underline">
            {state.admin.slice(0, 10)}…{state.admin.slice(-6)}
          </a>
        </p>
      )}

      {/* Admin session */}
      <section className="mt-8 rounded-2xl border border-ink-800 bg-ink-900 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-white">Admin session</p>
          <span
            className={`flex items-center gap-1.5 text-[11px] font-semibold ${token ? "text-vital" : "text-ink-600"}`}
          >
            <span className={`size-2 rounded-full ${token ? "bg-vital" : "bg-ink-600"}`} />
            {token ? "writes unlocked" : "read-only"}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-600">
          The token is checked server-side; the deployer key that actually signs
          never reaches this browser. Kept in this device&apos;s local storage
          only.
        </p>
        <input
          type="password"
          value={token}
          onChange={(e) => saveToken(e.target.value)}
          placeholder="Admin token"
          autoComplete="off"
          className="mt-3 w-full rounded-lg border border-ink-700 bg-ink-950 px-4 py-3 text-sm text-white placeholder:text-ink-600 focus:border-implant focus:outline-none"
        />
        {state && !state.writesEnabled && (
          <p className="mt-2 text-[11px] text-caution">
            The server has no ADMIN_TOKEN configured — writes will be refused
            until one is set in the environment.
          </p>
        )}
      </section>

      {/* Register form */}
      <section className="mt-6 rounded-2xl border border-ink-800 bg-ink-900 p-5">
        <p className="text-sm font-bold text-white">Register a clinician</p>
        <p className="mt-1 text-xs text-ink-600">
          The provider&apos;s wallet address comes from their Privy login. HFR ID
          binds it to a real facility.
        </p>
        <form onSubmit={register} className="mt-4 space-y-3">
          <Field
            label="Provider wallet address"
            value={form.provider}
            onChange={(v) => setForm((f) => ({ ...f, provider: v }))}
            placeholder="0x…"
            mono
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="HFR facility ID"
              value={form.hfrId}
              onChange={(v) => setForm((f) => ({ ...f, hfrId: v }))}
              placeholder="HFR-MP-GWL-0042"
            />
            <Field
              label="Display name"
              value={form.name}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))}
              placeholder="Dr. Sharma, Gwalior Trauma Centre"
            />
          </div>
          <button
            type="submit"
            disabled={busy !== null}
            className="w-full rounded-xl bg-vital px-5 py-3.5 font-bold text-ink-950 transition hover:brightness-110 disabled:opacity-40"
          >
            {busy === "register" ? "Registering on-chain…" : "Register provider"}
          </button>
        </form>
      </section>

      {/* Result note */}
      {note && (
        <p
          className={`mt-5 rounded-xl p-4 text-sm ${
            note.tone === "ok" ? "bg-vital/10 text-vital" : "bg-critical/10 text-critical"
          }`}
        >
          {note.text}
          {note.href && (
            <a href={note.href} target="_blank" rel="noreferrer" className="ml-2 underline">
              view tx ↗
            </a>
          )}
        </p>
      )}

      {/* Roster */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold tracking-widest text-ink-600 uppercase">
            Registered providers · on-chain
          </p>
          <span className="flex items-center gap-1.5 text-xs text-ink-600">
            <span className="size-2 animate-pulse rounded-full bg-vital" /> live
          </span>
        </div>

        {loadError && (
          <p className="mt-4 rounded-xl bg-critical/10 p-4 text-sm text-critical">{loadError}</p>
        )}

        {!state && !loadError && (
          <p className="mt-4 text-sm text-ink-600">Reading the registry…</p>
        )}

        {state && providers.length === 0 && (
          <p className="mt-4 rounded-xl border border-dashed border-ink-800 p-6 text-center text-sm text-ink-600">
            No providers registered yet. Add the first one above.
          </p>
        )}

        <ul className="mt-4 space-y-3">
          {providers.map((p) => (
            <li
              key={p.address}
              className="rounded-2xl border border-ink-800 bg-ink-900 p-4 sm:p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-base font-semibold text-white">
                      {p.name || "Unnamed provider"}
                    </p>
                    {p.active ? (
                      <span className="rounded-full bg-vital/15 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-vital uppercase">
                        Active
                      </span>
                    ) : (
                      <span className="rounded-full bg-critical/15 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-critical uppercase">
                        Revoked
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-ink-600">{p.hfrId || "no HFR ID"}</p>
                  <a
                    href={explorerAddress(p.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block font-mono text-[11px] text-info underline"
                  >
                    {p.address.slice(0, 12)}…{p.address.slice(-8)}
                  </a>
                  {p.registeredAt > 0 && (
                    <p className="mt-1 text-[11px] text-ink-600">
                      registered {new Date(p.registeredAt * 1000).toLocaleDateString()}
                    </p>
                  )}
                </div>

                {p.active ? (
                  <button
                    onClick={() =>
                      act({ action: "revoke", provider: p.address }, p.address, `Revoked ${p.name || "provider"}.`)
                    }
                    disabled={busy !== null}
                    className="shrink-0 rounded-lg border border-critical/50 px-3 py-1.5 text-xs font-bold text-critical transition hover:bg-critical/10 disabled:opacity-40"
                  >
                    {busy === p.address ? "…" : "Revoke"}
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      act({ action: "reinstate", provider: p.address }, p.address, `Reinstated ${p.name || "provider"}.`)
                    }
                    disabled={busy !== null}
                    className="shrink-0 rounded-lg border border-vital/50 px-3 py-1.5 text-xs font-bold text-vital transition hover:bg-vital/10 disabled:opacity-40"
                  >
                    {busy === p.address ? "…" : "Reinstate"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 text-center text-[11px] text-ink-600">
        Registry writes are admin-gated and signed server-side · Base Sepolia
      </p>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "vital" | "critical" }) {
  const color = tone === "vital" ? "text-vital" : tone === "critical" ? "text-critical" : "text-white";
  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900 px-4 py-3">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-medium tracking-wide text-ink-600 uppercase">{label}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-600 uppercase">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className={`w-full rounded-lg border border-ink-700 bg-ink-950 px-4 py-3 text-sm text-white placeholder:text-ink-600 focus:border-implant focus:outline-none ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}
