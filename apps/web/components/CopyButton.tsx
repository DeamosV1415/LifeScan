"use client";

import { useState } from "react";

/**
 * A copy-to-clipboard button with a tactile, phone-friendly confirm: the icon
 * morphs copy → check, the pill turns vital-green, the label pops, and it fires
 * a short haptic buzz on devices that support it. Reverts after ~1.6s.
 */
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  className = "",
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked (insecure context) — still show the confirm */
    }
    navigator.vibrate?.(12);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      aria-label={copied ? copiedLabel : label}
      className={`copybtn ${copied ? "is-copied" : ""} ${className}`}
    >
      <span className="copybtn-ic" aria-hidden>
        <svg className="ic-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
        <svg className="ic-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
      <span className="copybtn-label">{copied ? copiedLabel : label}</span>
    </button>
  );
}
