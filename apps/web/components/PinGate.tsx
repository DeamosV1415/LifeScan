"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The PIN gate shown on a locked card's scan page. It blocks the medical
 * preview until the correct PIN is verified server-side; on success it hands the
 * returned Tier-0 payload back to the scan page to render.
 *
 * Deliberately its own screen, not a dismissible overlay — a locked card shows
 * nothing until unlocked, matching the "private preview" contract.
 */
export function PinGate({
  cardId,
  online,
  onUnlock,
}: {
  cardId: string;
  online: boolean;
  onUnlock: (tier0Body: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || busy || locked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/card-lock/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: cardId, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && typeof data.tier0 === "string") {
        onUnlock(data.tier0);
        return;
      }
      if (data.locked) setLocked(true);
      setError(data.error ?? "Incorrect PIN.");
      setPin("");
      inputRef.current?.focus();
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 pt-10">
      <div className="card overflow-hidden rise">
        <div
          className="flex flex-col items-center gap-3 border-b border-line px-6 py-7 text-center"
          style={{ background: "color-mix(in srgb, var(--info) 8%, transparent)" }}
        >
          <span className="grid size-14 place-items-center rounded-full bg-info/15 text-info">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          <div>
            <h1 className="text-lg font-bold text-text">This card is protected</h1>
            <p className="mt-1 text-sm text-muted">Enter the PIN to view the medical details.</p>
          </div>
        </div>

        <div className="p-6">
          {!online ? (
            <div className="rounded-xl border border-caution/40 bg-caution/10 px-4 py-3 text-center">
              <p className="text-sm font-semibold text-caution">No connection</p>
              <p className="mt-1 text-xs text-caution/80">
                A PIN-protected card is verified online. Reconnect to unlock it.
              </p>
            </div>
          ) : (
            <form onSubmit={submit}>
              <label className="eyebrow mb-1.5 block">Card PIN</label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type={reveal ? "text" : "password"}
                  inputMode="numeric"
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  disabled={busy || locked}
                  className="input pr-11 text-center text-lg tracking-[0.3em]"
                  placeholder="••••"
                  aria-label="Card PIN"
                />
                <button
                  type="button"
                  onClick={() => setReveal((r) => !r)}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted transition hover:text-text"
                  aria-label={reveal ? "Hide PIN" : "Show PIN"}
                  tabIndex={-1}
                >
                  {reveal ? <EyeOff /> : <Eye />}
                </button>
              </div>

              {error && (
                <p className={`mt-2 text-center text-xs ${locked ? "text-critical" : "text-caution"}`}>{error}</p>
              )}

              <button type="submit" disabled={busy || locked || !pin} className="btn btn-vital btn-block mt-4">
                {busy ? "Checking…" : locked ? "Locked" : "Unlock"}
              </button>
            </form>
          )}

          <p className="mt-5 text-center text-[11px] leading-relaxed text-faint">
            Card owner? Manage or reset the PIN from{" "}
            <a href="/patient" className="link">
              Your cards
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

function Eye() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68M6.6 6.6C3.6 8.3 2 12 2 12s3.5 7 10 7a9.1 9.1 0 0 0 5.4-1.6M1 1l22 22M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}
