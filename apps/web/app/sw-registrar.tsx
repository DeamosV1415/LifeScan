"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes the scan page work with no network.
 *
 * This is the single most demo-critical piece of the app: the opening beat of
 * the pitch is a phone in airplane mode tapping an NFC card and showing
 * medical data. That only works if the app shell is already in the cache.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // In development the service worker caches Turbopack chunks and then serves
    // stale ones after a rebuild — surfacing as "module factory is not
    // available" crashes and phantom "my change didn't apply" renders. Offline
    // support is a production concern only, so here we actively tear down any
    // worker a previous session installed and never register in dev.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((reg) => reg.unregister()))
        .catch(() => {});
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
        // A failed registration must never break the page — it only costs us
        // offline support, and the online path still works.
        console.warn("[lifescan] service worker registration failed", error);
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
