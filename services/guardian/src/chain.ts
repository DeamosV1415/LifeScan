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
  {
    type: "function",
    name: "getAccessHistory",
    stateMutability: "view",
    inputs: [{ name: "patientHash", type: "bytes32" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "provider", type: "address" },
          { name: "timestamp", type: "uint64" },
          { name: "reasonCode", type: "uint16" },
          { name: "contextHash", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

const AGENT_LOG_ABI = [
  {
    type: "function",
    name: "isAgent",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

/** How long a break-glass grant remains usable. */
export const GRANT_WINDOW_SECONDS = 900n; // 15 minutes

export interface ChainConfig {
  rpcUrl: string;
  accessLogAddress: `0x${string}`;
  /** Optional — enables the autonomous-agent release path when set. */
  agentLogAddress?: `0x${string}`;
}

export function createChainReader({ rpcUrl, accessLogAddress, agentLogAddress }: ChainConfig) {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const readGrant = (patientHash: `0x${string}`, provider: `0x${string}`) =>
    client.readContract({
      address: accessLogAddress,
      abi: ACCESS_LOG_ABI,
      functionName: "hasRecentGrant",
      args: [patientHash, provider, GRANT_WINDOW_SECONDS],
    });

  return {
    /**
     * The single on-chain question a Guardian asks before releasing a share.
     *
     * Base's public RPC is load-balanced, so a read issued moments after the
     * break-glass transaction confirms can land on a node that has not yet seen
     * that block and wrongly report no grant. We retry a false result a few
     * times to absorb that propagation lag. This only costs latency: a record
     * that is genuinely frozen or has no grant still returns false after the
     * retries, so the patient's revoke stays enforced.
     */
    async isReleasePermitted(
      patientHash: `0x${string}`,
      provider: `0x${string}`,
    ): Promise<boolean> {
      const attempts = 3;
      for (let i = 0; i < attempts; i++) {
        if (await readGrant(patientHash, provider)) return true;
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000));
      }
      return false;
    },

    /**
     * The autonomous-agent release path.
     *
     * The triage agent is not the human provider, so it cannot present the
     * provider's grant. Instead a Guardian releases to it only when BOTH hold:
     *   - the agent is authorised on-chain (AgentActionLog.isAgent), and
     *   - a real break-glass grant for this patient exists within the window
     *     AND the record is not frozen.
     * So the agent can only ever decrypt off the back of a genuine break-glass
     * event, and a patient freeze shuts it out exactly as it shuts out a human.
     */
    async isAgentReleasePermitted(
      patientHash: `0x${string}`,
      agent: `0x${string}`,
    ): Promise<boolean> {
      if (!agentLogAddress) return false;

      const authorized = await client.readContract({
        address: agentLogAddress,
        abi: AGENT_LOG_ABI,
        functionName: "isAgent",
        args: [agent],
      });
      if (!authorized) return false;

      const attempts = 3;
      for (let i = 0; i < attempts; i++) {
        if (await this.hasAnyRecentGrant(patientHash)) return true;
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000));
      }
      return false;
    },

    /** True if any unexpired grant exists for the patient and it is not frozen. */
    async hasAnyRecentGrant(patientHash: `0x${string}`): Promise<boolean> {
      if (await this.isFrozen(patientHash)) return false;

      const history = (await client.readContract({
        address: accessLogAddress,
        abi: ACCESS_LOG_ABI,
        functionName: "getAccessHistory",
        args: [patientHash],
      })) as readonly { timestamp: bigint }[];

      const now = BigInt(Math.floor(Date.now() / 1000));
      return history.some((record) => record.timestamp + GRANT_WINDOW_SECONDS >= now);
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
