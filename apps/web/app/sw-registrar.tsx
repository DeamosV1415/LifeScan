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
