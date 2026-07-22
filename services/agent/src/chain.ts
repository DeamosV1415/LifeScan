import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  encodeAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

/**
 * The agent's chain interface: watch for break-glass, collect key shares as an
 * authorised agent, and anchor every action it takes.
 *
 * The agent has its own key (AGENT_PRIVATE_KEY), authorised once via
 * AgentActionLog.authorizeAgent. It never holds a standing decryption key — it
 * reconstructs one only from Guardian shares released against a real grant, and
 * every action it then takes is hashed on-chain here.
 */

const ACCESS_LOG_ABI = [
  {
    type: "event",
    name: "BreakGlassGranted",
    inputs: [
      { name: "patientHash", type: "bytes32", indexed: true },
      { name: "provider", type: "address", indexed: true },
      { name: "timestamp", type: "uint64", indexed: false },
      { name: "reasonCode", type: "uint16", indexed: false },
      { name: "contextHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

const AGENT_LOG_ABI = [
  {
    type: "function",
    name: "logAction",
    stateMutability: "nonpayable",
    inputs: [
      { name: "patientHash", type: "bytes32" },
      { name: "actionType", type: "uint8" },
      { name: "payloadHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isAgent",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export const ACTION = {
  TRIAGE_ASSESSMENT: 1,
  CONTRAINDICATION_ALERT: 2,
  SBAR_HANDOFF: 3,
  CONTACTS_NOTIFIED: 4,
  ER_NOTIFIED: 5,
  PREAUTH_PACKET: 6,
  FLAGGED_FOR_HUMAN: 7,
} as const;

export interface AgentChain {
  agentAddress: `0x${string}`;
  isAuthorized(): Promise<boolean>;
  watchBreakGlass(onEvent: (e: BreakGlassEvent) => void): () => void;
  signChallenge(message: string): Promise<`0x${string}`>;
  logAction(patientHash: `0x${string}`, actionType: number, payload: unknown): Promise<`0x${string}`>;
  explorerTx(hash: string): string;
}

export interface BreakGlassEvent {
  patientHash: `0x${string}`;
  provider: `0x${string}`;
  reasonCode: number;
  contextHash: `0x${string}`;
}

export function createAgentChain(config: {
  rpcUrl: string;
  accessLogAddress: `0x${string}`;
  agentLogAddress: `0x${string}`;
  privateKey: string;
}): AgentChain {
  const key = config.privateKey.trim();
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl) });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(config.rpcUrl) });

  // The agent may fire several actions in quick succession; track the nonce
  // locally so back-to-back logAction txs do not collide.
  let noncePromise: Promise<number> | null = null;
  async function nextNonce(): Promise<number> {
    if (!noncePromise) {
      noncePromise = publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
    }
    const n = await noncePromise;
    noncePromise = Promise.resolve(n + 1);
    return n;
  }

  return {
    agentAddress: account.address,

    async isAuthorized() {
      return publicClient.readContract({
        address: config.agentLogAddress,
        abi: AGENT_LOG_ABI,
        functionName: "isAgent",
        args: [account.address],
      });
    },

    watchBreakGlass(onEvent) {
      return publicClient.watchContractEvent({
        address: config.accessLogAddress,
        abi: ACCESS_LOG_ABI,
        eventName: "BreakGlassGranted",
        onLogs: (logs) => {
          for (const log of logs) {
            const a = log.args as Partial<BreakGlassEvent>;
            if (a.patientHash && a.provider) {
              onEvent({
                patientHash: a.patientHash,
                provider: a.provider,
                reasonCode: Number(a.reasonCode ?? 0),
                contextHash: (a.contextHash ?? toHex(new Uint8Array(32))) as `0x${string}`,
              });
            }
          }
        },
      });
    },

    async signChallenge(message) {
      return account.signMessage({ message });
    },

    async logAction(patientHash, actionType, payload) {
      // Anchor the hash of the exact payload, so the off-chain reasoning can be
      // proven later and cannot be quietly revised.
      const payloadHash = keccak256(
        encodeAbiParameters([{ type: "string" }], [JSON.stringify(payload)]),
      );

      return walletClient.writeContract({
        address: config.agentLogAddress,
        abi: AGENT_LOG_ABI,
        functionName: "logAction",
        args: [patientHash, actionType, payloadHash],
        nonce: await nextNonce(),
      });
    },

    explorerTx(hash) {
      return `https://sepolia.basescan.org/tx/${hash}`;
    },
  };
}
