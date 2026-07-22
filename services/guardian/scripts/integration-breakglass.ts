/**
 * End-to-end break-glass proof against the REAL deployed contracts.
 *
 * Runs the entire Tier-1 path with no UI and no Privy — just the protocol:
 *
 *   seal → mirror ciphertext → distribute 3 shares → register provider on-chain
 *   → requestBreakGlass on-chain → collect 2 shares (each guardian re-checks the
 *   chain itself) → reconstruct key → decrypt → assert it matches.
 *
 * Then it proves the refusal path: freeze the record on-chain and confirm the
 * guardians stop releasing. This is the on-stage revoke moment, verified.
 *
 * Requires the three local guardians running (pnpm --filter @lifescan/guardian
 * start:all) and DEPLOYER_PRIVATE_KEY funded on Base Sepolia. Uses the deployer
 * as the test provider since it is the only funded key.
 */

import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, keccak256, toHex, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { sealRecord, openRecord } from "@lifescan/crypto";

// Minimal .env.local loader — keeps this script dependency-free.
for (const line of fs.readFileSync(path.resolve(import.meta.dirname, "../../../.env.local"), "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}

const RPC = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const REGISTRY = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as `0x${string}`;
const ACCESS_LOG = process.env.NEXT_PUBLIC_ACCESS_LOG_ADDRESS as `0x${string}`;
const GUARDIANS = (process.env.NEXT_PUBLIC_GUARDIAN_URLS ?? "").split(",").map((s) => s.trim());

const rawKey = process.env.DEPLOYER_PRIVATE_KEY!.trim();
const account = privateKeyToAccount((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });

const REGISTRY_ABI = [
  { type: "function", name: "isActive", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "registerProvider", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "string" }, { type: "string" }], outputs: [] },
] as const;

const ACCESS_ABI = [
  { type: "function", name: "requestBreakGlass", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "uint16" }, { type: "bytes32" }], outputs: [] },
  { type: "function", name: "registerPatient", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
  { type: "function", name: "freezeRecord", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "unfreezeRecord", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
] as const;

const patientHash = keccak256(toHex(`lifescan:integration:${Date.now()}`));
const record = { name: "Integration Test", bloodGroup: "AB-", allergies: ["Penicillin"], meds: ["Warfarin"] };

function challengeMessage(hash: string, nonce: string) {
  return `LifeScan break-glass\npatient: ${hash}\nnonce: ${nonce}`;
}

async function collectShares(threshold: number) {
  const shares: string[] = [];
  const refusals: string[] = [];

  for (const url of GUARDIANS) {
    if (shares.length >= threshold) break;
    const { nonce } = await (await fetch(`${url}/challenge`)).json();
    const signature = await account.signMessage({ message: challengeMessage(patientHash, nonce) });
    const res = await fetch(`${url}/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patientHash, provider: account.address, nonce, signature }),
    });
    const body = await res.json();
    if (body.released) shares.push(body.share);
    else refusals.push(`${url}: ${body.reason}`);
  }
  return { shares, refusals };
}

function ok(label: string) { console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
function fail(label: string): never { console.error(`  \x1b[31m✗ ${label}\x1b[0m`); process.exit(1); }

async function main() {
  console.log(`\nprovider  ${account.address}`);
  console.log(`patient   ${patientHash}\n`);

  // Seal + distribute + mirror (mirror is in-process; the app route does the same).
  const sealed = await sealRecord(record);
  if (sealed.shares.length !== GUARDIANS.length) fail(`have ${GUARDIANS.length} guardians for ${sealed.shares.length} shares`);
  ok("record sealed, key split 2-of-3");

  for (let i = 0; i < GUARDIANS.length; i++) {
    const res = await fetch(`${GUARDIANS[i]}/shares`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ patientHash, share: sealed.shares[i] }),
    });
    if (!res.ok) fail(`guardian ${i + 1} rejected its share (is the cluster running?)`);
  }
  ok("one share distributed to each of 3 guardians");

  // Register provider if needed.
  if (!(await publicClient.readContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: "isActive", args: [account.address] }))) {
    const tx = await wallet.writeContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: "registerProvider", args: [account.address, "HFR-TEST", "Integration Provider"] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    ok("provider registered on-chain");
  } else {
    ok("provider already registered");
  }

  // Guardians must refuse BEFORE any grant exists.
  const before = await collectShares(2);
  if (before.shares.length !== 0) fail("guardians released a share with no on-chain grant!");
  ok("guardians refuse with no grant (no shares released)");

  // Break glass on-chain.
  const grantTx = await wallet.writeContract({ address: ACCESS_LOG, abi: ACCESS_ABI, functionName: "requestBreakGlass", args: [patientHash, 2, zeroHash] });
  await publicClient.waitForTransactionReceipt({ hash: grantTx });
  ok(`break-glass granted on-chain (${grantTx.slice(0, 12)}…)`);

  // Now 2 of 3 guardians should release.
  const after = await collectShares(2);
  if (after.shares.length < 2) fail(`only ${after.shares.length} shares after grant: ${after.refusals.join("; ")}`);
  ok(`2 guardians verified the grant on-chain and released shares`);

  const opened = await openRecord(sealed.ciphertext, after.shares);
  if (JSON.stringify(opened) !== JSON.stringify(record)) fail("decrypted record does not match original");
  ok("record decrypted from 2 shares — matches original");

  // The revoke moment: freeze, then confirm guardians stop.
  if ((await publicClient.readContract({ address: ACCESS_LOG, abi: ACCESS_ABI, functionName: "ownerOf", args: [patientHash] })) === "0x0000000000000000000000000000000000000000") {
    const claimTx = await wallet.writeContract({ address: ACCESS_LOG, abi: ACCESS_ABI, functionName: "registerPatient", args: [patientHash] });
    await publicClient.waitForTransactionReceipt({ hash: claimTx });
  }
  const freezeTx = await wallet.writeContract({ address: ACCESS_LOG, abi: ACCESS_ABI, functionName: "freezeRecord", args: [patientHash] });
  await publicClient.waitForTransactionReceipt({ hash: freezeTx });
  ok("patient froze the record on-chain");

  // The freeze must propagate across the load-balanced public RPC before every
  // guardian's node reflects it — the same lag as the grant, in reverse. In the
  // live demo the human gap between freezing and the provider re-attempting is
  // several seconds, far longer than propagation, so it is genuinely enforced.
  // Here we poll until enforced, with a timeout, rather than racing the lag.
  const deadline = Date.now() + 30_000;
  let enforced = false;
  while (Date.now() < deadline) {
    if ((await collectShares(2)).shares.length === 0) { enforced = true; break; }
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!enforced) fail("guardians STILL released 20s after freeze — revoke is not enforced!");
  ok("guardians refuse after freeze — revoke is enforced by the chain");

  // Clean up so the test hash can be reused conceptually.
  await publicClient.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: ACCESS_LOG, abi: ACCESS_ABI, functionName: "unfreezeRecord", args: [patientHash] }),
  });

  console.log(`\n\x1b[32mBREAK-GLASS PATH VERIFIED END-TO-END AGAINST LIVE CONTRACTS\x1b[0m\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
