"use client";

import { useEffect, useState } from "react";

/**
 * Owner controls for a card's optional PIN lock, shown on the /patient hub.
 *
 * Reflects and drives the same lock the scan page enforces: set a PIN, change
 * it, remove it, or — if forgotten — reset it with a one-time code emailed to
 * the account address. Locking a card also strips the medical payload from its
 * saved URL server-side, so the parent list is refreshed after any change.
 */

type Mode = "idle" | "set" | "change" | "remove" | "reset";

export function CardLockControls({
  card,
  email,
  onChanged,
}: {
  card: { id: string; name: string; url?: string };
  email: string;
  onChanged?: () => void;
}) {
  const [protectedOn, setProtectedOn] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>("idle");

  const refresh = () => {
    fetch(`/api/card-lock?id=${encodeURIComponent(card.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setProtectedOn(Boolean(d?.protected)))
      .catch(() => setProtectedOn(null));
  };
  useEffect(refresh, [card.id]);

  const done = () => {
    setMode("idle");
    refresh();
    onChanged?.();
  };

  if (protectedOn === null) return null;

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium">
          {protectedOn ? (
            <>
              <LockIcon className="text-info" />
              <span className="text-info">PIN protected</span>
            </>
          ) : (
            <>
              <LockOpenIcon className="text-faint" />
              <span className="text-faint">No PIN — opens instantly</span>
            </>
          )}
        </span>

        {mode === "idle" && (
          <div className="flex gap-2">
            {protectedOn ? (
              <>
                <button className="chip chip-muted" onClick={() => setMode("change")}>Change PIN</button>
                <button className="chip chip-muted" onClick={() => setMode("reset")}>Reset</button>
                <button className="chip chip-muted" onClick={() => setMode("remove")}>Remove</button>
              </>
            ) : (
              <button className="chip chip-info" onClick={() => setMode("set")}>Set a PIN</button>
            )}
          </div>
        )}
      </div>

      {mode !== "idle" && (
        <div className="mt-3 rounded-xl border border-line bg-[var(--field)] p-3">
          {mode === "set" && <SetForm card={card} email={email} onDone={done} onCancel={() => setMode("idle")} />}
          {mode === "change" && <ChangeForm cardId={card.id} email={email} onDone={done} onCancel={() => setMode("idle")} />}
          {mode === "remove" && <RemoveForm cardId={card.id} email={email} onDone={done} onCancel={() => setMode("idle")} />}
          {mode === "reset" && <ResetForm cardId={card.id} email={email} onDone={done} onCancel={() => setMode("idle")} />}
        </div>
      )}
    </div>
  );
}

// --- forms ---------------------------------------------------------------

function SetForm({
  card,
  email,
  onDone,
  onCancel,
}: {
  card: { id: string; url?: string };
  email: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const { busy, err, run } = useAction();

  const tier0 = card.url?.includes("#") ? card.url.split("#")[1] : "";

  const submit = () => {
    if (pin !== pin2) return run(async () => { throw new Error("PINs don't match."); });
    if (!tier0) return run(async () => { throw new Error("This card's data isn't available to lock from here."); });
    run(async () => {
      const res = await fetch("/api/card-lock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set", id: card.id, email, pin, tier0 }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't set PIN.");
      onDone();
    });
  };

  return (
    <FormShell title="Set a PIN" hint="At least 4 characters. Anyone tapping the card will need it." onCancel={onCancel}>
      <SecretInput label="New PIN" value={pin} onChange={setPin} placeholder="e.g. 4-digit" autoFocus />
      <SecretInput label="Confirm PIN" value={pin2} onChange={setPin2} />
      <Err err={err} />
      <button className="btn btn-vital btn-block mt-1" disabled={busy || !pin} onClick={submit}>
        {busy ? "Locking…" : "Lock card"}
      </button>
    </FormShell>
  );
}

function ChangeForm({ cardId, email, onDone, onCancel }: FormProps) {
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const { busy, err, run } = useAction();

  const submit = () =>
    run(async () => {
      const res = await fetch("/api/card-lock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "change", id: cardId, email, currentPin: current, pin }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't change PIN.");
      onDone();
    });

  return (
    <FormShell title="Change PIN" onCancel={onCancel}>
      <SecretInput label="Current PIN" value={current} onChange={setCurrent} autoFocus />
      <SecretInput label="New PIN" value={pin} onChange={setPin} />
      <Err err={err} />
      <button className="btn btn-vital btn-block mt-1" disabled={busy || !current || !pin} onClick={submit}>
        {busy ? "Saving…" : "Save new PIN"}
      </button>
    </FormShell>
  );
}

function RemoveForm({ cardId, email, onDone, onCancel }: FormProps) {
  const [current, setCurrent] = useState("");
  const { busy, err, run } = useAction();

  const submit = () =>
    run(async () => {
      const res = await fetch("/api/card-lock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "remove", id: cardId, email, currentPin: current }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't remove PIN.");
      onDone();
    });

  return (
    <FormShell title="Remove PIN" hint="The card will open instantly again, offline included." onCancel={onCancel}>
      <SecretInput label="Current PIN" value={current} onChange={setCurrent} autoFocus />
      <Err err={err} />
      <button className="btn btn-block mt-1 border border-critical/50 text-critical hover:bg-critical/10" disabled={busy || !current} onClick={submit}>
        {busy ? "Removing…" : "Remove PIN"}
      </button>
    </FormShell>
  );
}

/** Forgot-PIN reset: request a code by email, then confirm it with a new PIN
 *  (or leave the new PIN blank to remove the lock entirely). */
function ResetForm({ cardId, email, onDone, onCancel }: FormProps) {
  const [sent, setSent] = useState(false);
  const [dev, setDev] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [code, setCode] = useState("");
  const [newPin, setNewPin] = useState("");
  const { busy, err, run } = useAction();

  const request = () =>
    run(async () => {
      const res = await fetch("/api/card-lock/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "request", id: cardId, email }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Couldn't send a code.");
      setDev(Boolean(d.dev));
      setEmailError(Boolean(d.emailError));
      setSent(true);
    });

  const confirm = () =>
    run(async () => {
      const res = await fetch("/api/card-lock/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "confirm", id: cardId, email, otp: code, newPin }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't verify the code.");
      onDone();
    });

  return (
    <FormShell title="Reset PIN by email" onCancel={onCancel}>
      {!sent ? (
        <>
          <p className="mb-2 text-xs text-muted">
            We&apos;ll email a one-time code to <span className="text-text">{email}</span>.
          </p>
          <Err err={err} />
          <button className="btn btn-vital btn-block" disabled={busy} onClick={request}>
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </>
      ) : (
        <>
          {emailError && (
            <p className="mb-2 rounded-lg border border-caution/40 bg-caution/10 px-2.5 py-1.5 text-[11px] text-caution">
              The code couldn&apos;t be emailed — check RESEND_FROM / domain verification on the server. The code was
              still generated (check the server logs).
            </p>
          )}
          <p className="mb-2 text-xs text-muted">
            Enter the 6-digit code{dev ? " (dev mode: check the server console)" : ` sent to ${email}`}. Leave the new
            PIN blank to remove the lock instead.
          </p>
          <label className="eyebrow mb-1 block">Reset code</label>
          <input
            className="input mb-2 text-center tracking-[0.3em]"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000000"
            autoFocus
          />
          <SecretInput label="New PIN (optional)" value={newPin} onChange={setNewPin} placeholder="blank = remove lock" />
          <Err err={err} />
          <button className="btn btn-vital btn-block mt-1" disabled={busy || !code} onClick={confirm}>
            {busy ? "Verifying…" : newPin ? "Set new PIN" : "Remove lock"}
          </button>
          <button className="mt-2 w-full text-center text-[11px] text-muted hover:text-text" onClick={request} disabled={busy}>
            Resend code
          </button>
        </>
      )}
    </FormShell>
  );
}

// --- shared bits ----------------------------------------------------------

interface FormProps {
  cardId: string;
  email: string;
  onDone: () => void;
  onCancel: () => void;
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, run };
}

function FormShell({
  title,
  hint,
  children,
  onCancel,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-text">{title}</p>
          {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
        </div>
        <button className="text-[11px] text-muted hover:text-text" onClick={onCancel} aria-label="Cancel">
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}

function SecretInput({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <label className="block">
      <span className="eyebrow mb-1 block">{label}</span>
      <div className="relative mb-2">
        <input
          type={reveal ? "text" : "password"}
          className="input pr-10"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setReveal((r) => !r)}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted transition hover:text-text"
          aria-label={reveal ? "Hide" : "Show"}
          tabIndex={-1}
        >
          {reveal ? "🙈" : "👁"}
        </button>
      </div>
    </label>
  );
}

function Err({ err }: { err: string | null }) {
  if (!err) return null;
  return <p className="mb-2 text-[11px] text-critical">{err}</p>;
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function LockOpenIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}
