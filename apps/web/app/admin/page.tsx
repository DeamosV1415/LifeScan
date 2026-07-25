"use client";

import { useCallback, useEffect, useState } from "react";
import { explorerAddress, explorerTx } from "@/lib/contracts";
import { Wordmark, Eyebrow, LivePill } from "@/components/ui";

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
const HIDDEN_KEY = "lifescan.admin.hiddenProviders";

export default function AdminPage() {
  const [state, setState] = useState<RegistryState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [token, setToken] = useState("");

  const [form, setForm] = useState({ provider: "", hfrId: "", name: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; href?: string; tone: "ok" | "err" } | null>(null);

  // Console-local "removed" set for revoked providers (see hideProvider).
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

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
    try {
      const raw = localStorage.getItem(HIDDEN_KEY);
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* malformed — start with an empty removed set */
    }
    refresh();
    const id = setInterval(refresh, 6000);
    return () => clearInterval(id);
  }, [refresh]);

  const saveToken = useCallback((value: string) => {
    setToken(value);
    localStorage.setItem(TOKEN_KEY, value);
  }, []);

  // "Remove" is a console-local hide, offered only for REVOKED providers. The
  // on-chain registry is append-only and immutable — a revoked provider cannot
  // be deleted, and that permanence is the accountability property. So Remove
  // just suppresses the row on this device; the record stays revoked on-chain
  // and can be shown again. Because we only ever hide a revoked provider,
  // reinstating one brings it back on its own.
  const persistHidden = useCallback((next: Set<string>) => {
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {
      /* storage blocked — the in-memory set still applies this session */
    }
  }, []);

  const hideProvider = useCallback(
    (address: string, name: string) => {
      const next = new Set(hidden);
      next.add(address.toLowerCase());
      persistHidden(next);
      setNote({
        text: `Removed ${name || "provider"} from the list — still revoked on-chain. Use “Show removed” to bring it back.`,
        tone: "ok",
      });
    },
    [hidden, persistHidden],
  );

  const unhideProvider = useCallback(
    (address: string) => {
      const next = new Set(hidden);
      next.delete(address.toLowerCase());
      persistHidden(next);
    },
    [hidden, persistHidden],
  );

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
  // A provider is "removed" only while revoked; an active one is always shown,
  // so reinstating auto-restores it to the list.
  const isRemoved = (p: ProviderRow) => !p.active && hidden.has(p.address.toLowerCase());
  const removedCount = providers.filter(isRemoved).length;
  const visibleProviders = showHidden ? providers : providers.filter((p) => !isRemoved(p));

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-5 py-10 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Wordmark />
        <span className="chip chip-implant">Admin</span>
      </div>

      <div className="mt-9 rise">
        <Eyebrow>Hospital onboarding</Eyebrow>
        <h1 className="mt-2 text-[2rem] leading-tight font-bold text-text">Provider registry</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
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
        <p className="mt-3 text-[11px] text-faint">
          Registry{" "}
          <a href={explorerAddress(state.registry)} target="_blank" rel="noreferrer" className="link font-mono">
            {state.registry.slice(0, 10)}…{state.registry.slice(-6)}
          </a>{" "}
          · admin{" "}
          <a href={explorerAddress(state.admin)} target="_blank" rel="noreferrer" className="link font-mono">
            {state.admin.slice(0, 10)}…{state.admin.slice(-6)}
          </a>
        </p>
      )}

      {/* Admin session */}
      <section className="card mt-8 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-text">Admin session</p>
          <span className={`chip ${token ? "chip-vital" : "chip-muted"}`}>
            <span
              className="size-1.5 rounded-full"
              style={{ background: token ? "var(--vital)" : "var(--faint)" }}
            />
            {token ? "writes unlocked" : "read-only"}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">
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
          className="input mt-3"
        />
        {state && !state.writesEnabled && (
          <p className="mt-2 text-[11px] text-caution">
            The server has no ADMIN_TOKEN configured — writes will be refused
            until one is set in the environment.
          </p>
        )}
      </section>

      {/* Register form */}
      <section className="card mt-6 p-5">
        <p className="text-sm font-semibold text-text">Register a clinician</p>
        <p className="mt-1 text-xs text-muted">
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
          <button type="submit" disabled={busy !== null} className="btn btn-vital btn-block">
            {busy === "register" ? "Registering on-chain…" : "Register provider"}
          </button>
        </form>
      </section>

      {/* Result note */}
      {note && (
        <p
          className={`mt-5 rounded-xl border p-4 text-sm ${
            note.tone === "ok"
              ? "border-vital/30 bg-vital/10 text-vital"
              : "border-critical/30 bg-critical/10 text-critical"
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
          <Eyebrow>Registered providers · on-chain</Eyebrow>
          <LivePill live label="live" />
        </div>

        {loadError && (
          <p className="mt-4 rounded-xl border border-critical/30 bg-critical/10 p-4 text-sm text-critical">
            {loadError}
          </p>
        )}

        {!state && !loadError && <p className="mt-4 text-sm text-muted">Reading the registry…</p>}

        {state && providers.length === 0 && (
          <p className="mt-4 rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
            No providers registered yet. Add the first one above.
          </p>
        )}

        <ul className="mt-4 space-y-3">
          {visibleProviders.map((p) => (
            <li key={p.address} className="card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-base font-semibold text-text">
                      {p.name || "Unnamed provider"}
                    </p>
                    {p.active ? (
                      <span className="chip chip-vital">Active</span>
                    ) : (
                      <span className="chip chip-danger">Revoked</span>
                    )}
                    {isRemoved(p) && <span className="chip chip-muted">Removed</span>}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-faint">{p.hfrId || "no HFR ID"}</p>
                  <a
                    href={explorerAddress(p.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="link mt-1 inline-block font-mono text-[11px]"
                  >
                    {p.address.slice(0, 12)}…{p.address.slice(-8)}
                  </a>
                  {p.registeredAt > 0 && (
                    <p className="mt-1 text-[11px] text-faint">
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
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <button
                      onClick={() =>
                        act({ action: "reinstate", provider: p.address }, p.address, `Reinstated ${p.name || "provider"}.`)
                      }
                      disabled={busy !== null}
                      className="rounded-lg border border-vital/50 px-3 py-1.5 text-xs font-bold text-vital transition hover:bg-vital/10 disabled:opacity-40"
                    >
                      {busy === p.address ? "…" : "Reinstate"}
                    </button>
                    {isRemoved(p) ? (
                      <button
                        onClick={() => unhideProvider(p.address)}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:text-text"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        onClick={() => hideProvider(p.address, p.name)}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-critical/50 hover:text-critical"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        {removedCount > 0 && (
          <button
            onClick={() => setShowHidden((s) => !s)}
            className="mt-4 text-xs font-medium text-muted transition hover:text-text"
          >
            {showHidden ? "Hide removed" : `Show ${removedCount} removed →`}
          </button>
        )}
      </section>

      <p className="mt-10 text-center text-[11px] text-faint">
        Registry writes are admin-gated and signed server-side · Base Sepolia
      </p>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "vital" | "critical" }) {
  const color = tone === "vital" ? "text-vital" : tone === "critical" ? "text-critical" : "text-text";
  return (
    <div className="card px-4 py-3">
      <p className={`font-display text-2xl font-bold tnum ${color}`}>{value}</p>
      <p className="eyebrow mt-0.5">{label}</p>
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
      <span className="eyebrow mb-1.5 block">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className={`input ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}
