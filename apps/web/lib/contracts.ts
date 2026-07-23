import { createPublicClient, http, keccak256, toHex } from "viem";
import { baseSepolia } from "viem/chains";

/**
 * On-chain client for the browser apps.
 *
 * Only the function fragments the frontend actually calls are declared, rather
 * than importing the full compiled ABIs — it keeps the bundle small and makes
 * the contract surface the app depends on explicit and readable.
 *
 * Addresses come from the deploy script via NEXT_PUBLIC_* env vars, so there is
 * no hand-copied address to drift out of sync.
 */

export const CHAIN = baseSepolia;

export const ADDRESSES = {
  registry: process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as `0x${string}` | undefined,
  accessLog: process.env.NEXT_PUBLIC_ACCESS_LOG_ADDRESS as `0x${string}` | undefined,
  agentLog: process.env.NEXT_PUBLIC_AGENT_LOG_ADDRESS as `0x${string}` | undefined,
  escrow: process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}` | undefined,
};

export function requireAddress(name: keyof typeof ADDRESSES): `0x${string}` {
  const address = ADDRESSES[name];
  if (!address) {
    throw new Error(
      `NEXT_PUBLIC_${name.toUpperCase()}_ADDRESS is not set. ` +
        "Run the contract deploy, or add it in the Vercel env settings.",
    );
  }
  return address;
}

/**
 * Reason codes mirror EmergencyAccessLog. Kept as a typed map so the provider
 * UI offers exactly the vocabulary the contract accepts.
 */
export const REASON_CODES = {
  UNCONSCIOUS: 1,
  TRAUMA: 2,
  CARDIAC: 3,
  OVERDOSE: 4,
  OTHER: 99,
} as const;

export type ReasonCode = (typeof REASON_CODES)[keyof typeof REASON_CODES];

/** Human-readable labels for the audit view, keyed by the on-chain reason code. */
export const REASON_LABELS: Record<number, string> = {
  1: "Unconscious patient",
  2: "Trauma / RTA",
  3: "Cardiac event",
  4: "Suspected overdose",
  99: "Other emergency",
};

export function reasonLabel(code: number): string {
  return REASON_LABELS[code] ?? `Reason ${code}`;
}

/**
 * The one and only thing that identifies a patient on-chain: a hash, never a
 * name or an ID in the clear. Both apps derive it the same way so a card sealed
 * by the patient app resolves to the same hash the provider app breaks glass on.
 */
export function patientHash(patientId: string): `0x${string}` {
  return keccak256(toHex(`lifescan:patient:${patientId.trim().toLowerCase()}`));
}

export const REGISTRY_ABI = [
  {
    type: "function",
    name: "isActive",
    stateMutability: "view",
    inputs: [{ name: "provider", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "providerCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "providerAt",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "getProvider",
    stateMutability: "view",
    inputs: [{ name: "provider", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "hfrId", type: "string" },
          { name: "name", type: "string" },
          { name: "active", type: "bool" },
          { name: "registeredAt", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "registerProvider",
    stateMutability: "nonpayable",
    inputs: [
      { name: "provider", type: "address" },
      { name: "hfrId", type: "string" },
      { name: "name", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeProvider",
    stateMutability: "nonpayable",
    inputs: [{ name: "provider", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "reinstateProvider",
    stateMutability: "nonpayable",
    inputs: [{ name: "provider", type: "address" }],
    outputs: [],
  },
] as const;

export const ACCESS_LOG_ABI = [
  {
    type: "function",
    name: "registerPatient",
    stateMutability: "nonpayable",
    inputs: [{ name: "patientHash", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "requestBreakGlass",
    stateMutability: "nonpayable",
    inputs: [
      { name: "patientHash", type: "bytes32" },
      { name: "reasonCode", type: "uint16" },
      { name: "contextHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "freezeRecord",
    stateMutability: "nonpayable",
    inputs: [{ name: "patientHash", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "unfreezeRecord",
    stateMutability: "nonpayable",
    inputs: [{ name: "patientHash", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "blockProvider",
    stateMutability: "nonpayable",
    inputs: [
      { name: "patientHash", type: "bytes32" },
      { name: "provider", type: "address" },
    ],
    outputs: [],
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
    name: "isBlocked",
    stateMutability: "view",
    inputs: [
      { name: "patientHash", type: "bytes32" },
      { name: "provider", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "patientHash", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "accessCount",
    stateMutability: "view",
    inputs: [{ name: "patientHash", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
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

function makePublicClient() {
  return createPublicClient({
    chain: CHAIN,
    transport: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"),
  });
}

let cachedPublicClient: ReturnType<typeof makePublicClient> | null = null;

/** A read-only client. Reused across calls; safe in the browser. */
export function publicClient() {
  return (cachedPublicClient ??= makePublicClient());
}

export function explorerTx(hash: string): string {
  return `https://sepolia.basescan.org/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `https://sepolia.basescan.org/address/${address}`;
}
