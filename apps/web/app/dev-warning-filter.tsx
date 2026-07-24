"use client";

import { useEffect } from "react";

/**
 * Silences a small, fixed set of benign console warnings that originate inside
 * third-party libraries we can't patch — not our own code.
 *
 * Today that's Privy (@privy-io/react-auth) and its styled-components dependency
 * leaking a non-standard `isActive` prop onto an internal DOM node. React and
 * styled-components emit these as *format strings* — the message template is
 * args[0] (e.g. "…does not recognize the %s prop…") and the prop name is a
 * separate argument — so we must join every arg before matching. These are
 * dev-only warnings (React strips them from production builds).
 *
 * The match is deliberately narrow: it fires only when the combined message
 * mentions `isActive` AND a known unknown-prop signature, so real errors and
 * warnings from our own code are never hidden.
 */
const SIGNATURES = [
  "does not recognize",
  "unknown prop",
  "non-boolean attribute",
  "styled-components",
];

function shouldSilence(args: unknown[]): boolean {
  const text = args
    .map((a) => (typeof a === "string" ? a : ""))
    .join(" ")
    .toLowerCase();
  if (!text.includes("isactive")) return false;
  return SIGNATURES.some((s) => text.includes(s));
}

export function DevWarningFilter() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    const origError = console.error;
    const origWarn = console.warn;

    console.error = (...args: unknown[]) => {
      if (shouldSilence(args)) return;
      origError(...args);
    };
    console.warn = (...args: unknown[]) => {
      if (shouldSilence(args)) return;
      origWarn(...args);
    };

    return () => {
      console.error = origError;
      console.warn = origWarn;
    };
  }, []);

  return null;
}
