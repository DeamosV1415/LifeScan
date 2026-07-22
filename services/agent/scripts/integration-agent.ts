/**
 * End-to-end agent proof against live contracts + guardians + OpenAI.
 *
 * Drives the exact building blocks the server uses:
 *   seal + distribute -> provider breaks glass on-chain -> agent collects shares
 *   via its authorised path -> decrypts -> OpenAI triage loop -> every action
 *   anchored on-chain. Prints the live trace and the real cost.
 *
 * Requires the 3 guardians running and setup-agent already done.
 */

import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { createPublicClient, createWalletClient, http, keccak256, toHex, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { sealRecord } from "@lifescan/crypto";
import { createAgentChain } from "../src/chain.ts";
import { collectAndDecrypt } from "../src/collect.ts";
import { runTriage } from "../src/reason.ts";
import { trace } from "../src/trace.ts";

for (const line of fs.readFileSync(path.resolve(import.meta.dirname, "../../../.env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const RPC = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const ACCESS_LOG = process.env.NEXT_PUBLIC_ACCESS_LOG_ADDRESS as `0x${string}`;
const REGISTRY = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as `0x${string}`;
const AGENT_LOG = process.env.NEXT_PUBLIC_AGENT_LOG_ADDRESS as `0x${string}`;
const GUARDIANS = (process.env.NEXT_PUBLIC_GUARDIAN_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const rawKey = process.env.DEPLOYER_PRIVATE_KEY!.trim();
const provider = privateKeyToAccount((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const wallet = createWalletClient({ account: provider, chain: baseSepolia, transport: http(RPC) });

const REGISTRY_ABI = [
  { type: "function", name: "isActive", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "registerProvider", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "string" }, { type: "string" }], outputs: [] },
] as const;
const ACCESS_ABI = [
  { type: "function", name: "requestBreakGlass", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "uint16" }, { type: "bytes32" }], outputs: [] },
] as const;
const AGENT_ABI = [
  { type: "function", name: "actionCount", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
] as const;

const patientHash = keccak256(toHex(`lifescan:agent-int:${Date.now()}`));
const record = {
  name: "Ramesh Kumar", bloodGroup: "O+",
  medications: [{ name: "Warfarin", dose: "5mg", frequency: "daily" }],
  allergies: [{ substance: "Penicillin", reaction: "Anaphylaxis", severity: "severe" }],
  implants: [{ type: "Pacemaker" }],
  emergencyContacts: [{ name: "Sunita Kumar", relation: "spouse", phone: "+919876543210" }],
};

function ok(s: string) { console.log(`  \x1b[32m✓\x1b[0m ${s}`); }
function fail(s: string): never { console.error(`  \x1b[31m✗ ${s}\x1b[0m`); process.exit(1); }

async function main() {
  // Live trace to the console.
  trace.on("trace", (e) => console.log(`    \x1b[2m[${e.kind}]\x1b[0m ${e.text}${e.href ? ` ${e.href}` : ""}`));

  const sealed = await sealRecord(record);
  for (let i = 0; i < GUARDIANS.length; i++) {
    const res = await fetch(`${GUARDIANS[i]}/shares`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patientHash, share: sealed.shares[i] }) });
    if (!res.ok) fail(`guardian ${i + 1} rejected share (cluster running?)`);
  }
  ok("sealed + distributed to 3 guardians");

  if (!(await publicClient.readContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: "isActive", args: [provider.address] }))) {
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: "registerProvider", args: [provider.address, "HFR-TEST", "Integration Provider"] }) });
  }
  ok("provider registered");

  const agentChain = createAgentChain({ rpcUrl: RPC, accessLogAddress: ACCESS_LOG, agentLogAddress: AGENT_LOG, privateKey: process.env.AGENT_PRIVATE_KEY! });
  if (!(await agentChain.isAuthorized())) fail("agent not authorized on-chain — run setup-agent");
  ok(`agent authorized on-chain (${agentChain.agentAddress.slice(0, 10)}…)`);

  await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: ACCESS_LOG, abi: ACCESS_ABI, functionName: "requestBreakGlass", args: [patientHash, 2, zeroHash] }) });
  ok("provider broke glass on-chain");

  const decrypted = await collectAndDecrypt({ chain: agentChain, guardianUrls: GUARDIANS, patientHash, ciphertext: sealed.ciphertext, threshold: 2 });
  if ((decrypted as { name: string }).name !== "Ramesh Kumar") fail("agent failed to decrypt via its authorised path");
  ok("agent collected 2 shares and decrypted the record");

  console.log("\n  --- live triage trace ---");
  const result = await runTriage({
    client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    model: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
    effort: (process.env.OPENAI_REASONING_EFFORT ?? "low") as never,
    chain: agentChain,
    patientHash,
    record: decrypted,
    paramedicContext: "male ~35, RTA, GCS 9, BP 90/60, considering ceftriaxone",
  });
  console.log("  --- end trace ---\n");

  if (result.actions.length === 0) fail("agent took no actions");
  ok(`agent took ${result.actions.length} actions, each anchored on-chain`);

  const onChain = await publicClient.readContract({ address: AGENT_LOG, abi: AGENT_ABI, functionName: "actionCount", args: [patientHash] });
  if (Number(onChain) !== result.actions.length) fail(`on-chain action count ${onChain} != ${result.actions.length}`);
  ok(`verified ${onChain} agent actions recorded on-chain`);

  console.log(`\n  real cost this run: \x1b[33m$${result.totalUsd.toFixed(4)}\x1b[0m across ${result.cost.length} model turns`);
  console.log(`\n\x1b[32mAGENT PATH VERIFIED END-TO-END: event → decrypt → reason → on-chain anchor\x1b[0m\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
