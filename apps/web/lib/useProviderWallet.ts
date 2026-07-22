"use client";

import { useCallback } from "react";
import { useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, type WalletClient } from "viem";
import { baseSepolia } from "viem/chains";

/**
 * Bridges Privy's embedded wallet to viem.
 *
 * Privy exposes a standard EIP-1193 provider from the embedded wallet; wrapping
 * it in a viem WalletClient lets the rest of the app use one chain library for
 * both reads and writes. The provider's key never leaves Privy's secure iframe
 * — we only ever get a provider that asks it to sign.
 */
export function useProviderWallet() {
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];

  const address = embedded?.address as `0x${string}` | undefined;

  const getWalletClient = useCallback(async (): Promise<WalletClient> => {
    if (!embedded) throw new Error("No wallet available — log in first.");

    // Ensure the embedded wallet is on Base Sepolia before signing anything.
    await embedded.switchChain(baseSepolia.id);
    const provider = await embedded.getEthereumProvider();

    return createWalletClient({
      account: embedded.address as `0x${string}`,
      chain: baseSepolia,
      transport: custom(provider),
    });
  }, [embedded]);

  const signMessage = useCallback(
    async (message: string): Promise<`0x${string}`> => {
      const client = await getWalletClient();
      return client.signMessage({
        account: embedded!.address as `0x${string}`,
        message,
      });
    },
    [getWalletClient, embedded],
  );

  return { address, getWalletClient, signMessage, hasWallet: Boolean(embedded) };
}
