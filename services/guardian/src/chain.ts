import { createPublicClient, http, verifyMessage } from "viem";
import { baseSepolia } from "viem/chains";

/**
 * The Guardian's independent view of the chain.
 *
 * This is the load-bearing part of the trust model. A Guardian never takes our
 * word — or any other Guardian's word — that a break-glass grant exists. It
 * reads the contract itself, over its own RPC connection. That is why
 * compromising our servers does not compromise a patient's record: the
 * decision to release a key share is made against on-chain state that we
 * cannot forge.
 */

const ACCESS_LOG_ABI = [
  {
    type: "function",
    name: "hasRecentGrant",
    stateMutability: "view",
    inputs: [
      { name: "patientHash", type: "bytes32" },
      { name: "provider", type: "address" },
      { name: "window", type: "uint64" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isFrozen",
    stateMutability: "view",
    inputs: [{ name: "patientHash", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
] as const;

/** How long a break-glass grant remains usable. */
export const GRANT_WINDOW_SECONDS = 900n; // 15 minutes

export interface ChainConfig {
  rpcUrl: string;
  accessLogAddress: `0x${string}`;
}

export function createChainReader({ rpcUrl, accessLogAddress }: ChainConfig) {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  return {
    /** The single on-chain question a Guardian asks before releasing a share. */
    async isReleasePermitted(
      patientHash: `0x${string}`,
      provider: `0x${string}`,
    ): Promise<boolean> {
      return client.readContract({
        address: accessLogAddress,
        abi: ACCESS_LOG_ABI,
        functionName: "hasRecentGrant",
        args: [patientHash, provider, GRANT_WINDOW_SECONDS],
      });
    },

    async isFrozen(patientHash: `0x${string}`): Promise<boolean> {
      return client.readContract({
        address: accessLogAddress,
        abi: ACCESS_LOG_ABI,
        functionName: "isFrozen",
        args: [patientHash],
      });
    },

    async blockNumber(): Promise<bigint> {
      return client.getBlockNumber();
    },
  };
}

export type ChainReader = ReturnType<typeof createChainReader>;

/**
 * Proof that the caller controls the provider key right now.
 *
 * Without this, anyone who observed a break-glass transaction on the public
 * chain could replay it against the Guardians and collect the shares. The
 * on-chain grant proves a clinician was authorised; this proves the person
 * asking is that clinician.
 */
export function challengeMessage(patientHash: string, nonce: string): string {
  return `LifeScan break-glass\npatient: ${patientHash}\nnonce: ${nonce}`;
}

export async function verifyProviderSignature(params: {
  provider: `0x${string}`;
  patientHash: string;
  nonce: string;
  signature: `0x${string}`;
}): Promise<boolean> {
  try {
    return await verifyMessage({
      address: params.provider,
      message: challengeMessage(params.patientHash, params.nonce),
      signature: params.signature,
    });
  } catch {
    return false;
  }
}
