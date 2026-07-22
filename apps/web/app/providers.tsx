"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { baseSepolia } from "viem/chains";

/**
 * Privy gives clinicians an embedded wallet from an email login — no seed
 * phrase, no MetaMask popup. That matters for the demo specifically: fumbling a
 * browser-extension wallet on stage is exactly the kind of avoidable failure
 * that sinks a live execution score.
 *
 * If the app ID is missing we still render children, so the patient app and the
 * offline scan page keep working without auth configured.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "dark", accentColor: "#2dd4a7" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        supportedChains: [baseSepolia],
        defaultChain: baseSepolia,
      }}
    >
      {children}
    </PrivyProvider>
  );
}
