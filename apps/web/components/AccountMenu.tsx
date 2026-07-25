"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy, useExportWallet } from "@privy-io/react-auth";
import { usePathname } from "next/navigation";
import { useProviderWallet } from "@/lib/useProviderWallet";
import { shortAddress } from "@/lib/contracts";
import { CopyButton } from "./CopyButton";

/**
 * A small, fixed profile tab shown top-right on every page. It surfaces the one
 * thing there was no way to see or change before: which Privy email you're
 * signed in as, and a way to sign out.
 *
 * It lives inside the single PrivyProvider, so the session it shows and toggles
 * is the same one every page uses — sign in here and you're signed in app-wide,
 * and vice-versa. Hidden on the offline scan page, which is a clean,
 * no-account emergency view.
 */
export function AccountMenu() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { address } = useProviderWallet();
  const { exportWallet } = useExportWallet();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // Keep the emergency scan screen free of any account chrome.
  if (pathname?.startsWith("/s/")) return null;
  if (!ready) return null;

  const email = user?.email?.address;
  const initial = email ? email[0]!.toUpperCase() : "?";

  // Privy shows the private key in a secure, cross-origin iframe that our app
  // cannot read — the user copies it to import the SAME wallet into MetaMask or
  // any other client. Requires "Export embedded wallet" to be enabled in the
  // Privy dashboard; if it isn't, the call rejects and we surface why.
  const doExport = async () => {
    if (!address) return;
    setExportErr(null);
    setExporting(true);
    try {
      await exportWallet({ address });
    } catch (e) {
      setExportErr(
        e instanceof Error ? e.message : "Export is unavailable — enable it in the Privy dashboard.",
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div ref={ref} className="account-menu">
      <button
        type="button"
        className="account-trigger"
        aria-label={authenticated ? "Account" : "Sign in"}
        aria-expanded={authenticated ? open : undefined}
        onClick={() => (authenticated ? setOpen((o) => !o) : login())}
      >
        {authenticated ? (
          <span className="account-avatar">{initial}</span>
        ) : (
          <span className="account-signin">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
            </svg>
            Sign in
          </span>
        )}
      </button>

      {authenticated && open && (
        <div className="account-pop" role="menu">
          <p className="account-pop-label">Signed in as</p>
          <p className="account-pop-email">{email ?? "—"}</p>

          {address && (
            <>
              <p className="account-pop-label account-pop-section">Wallet</p>
              <div className="account-pop-wallet">
                <code className="account-pop-addr" title={address}>
                  {shortAddress(address)}
                </code>
                <CopyButton text={address} label="Copy" />
              </div>
              <button
                type="button"
                className="account-export"
                onClick={doExport}
                disabled={exporting}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
                {exporting ? "Opening…" : "Export private key"}
              </button>
              <p className="account-export-hint">
                Opens a secure Privy window with your key — to import this wallet
                into MetaMask or another client.
              </p>
              {exportErr && <p className="account-export-err">{exportErr}</p>}
            </>
          )}

          <button
            type="button"
            className="account-signout"
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
