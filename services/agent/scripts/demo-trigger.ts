/**
 * Fires a real break-glass for the demo patient so the RUNNING agent picks it
 * up autonomously and streams triage to the ER dashboard.
 *
 * Unlike integration-agent.ts (which drives the pieces directly), this only
 * seeds + breaks glass, then gets out of the way — the live agent's
 * watchContractEvent does the rest, exactly as it will on stage.
 */

import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, keccak256, toHex, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { sealRecord } from "@lifescan/crypto";

for (const line of fs.readFileSync(path.resolve(import.meta.dirname, "../../../.env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const RPC = process.env.BASE_SEPOLIA_RPC_URL!;
const ACCESS = process.env.NEXT_PUBLIC_ACCESS_LOG_ADDRESS as `0x${string}`;
const REGISTRY = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as `0x${string}`;
const GUARDIANS = (process.env.NEXT_PUBLIC_GUARDIAN_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const WEB = process.env.RECORD_API_URL ?? "http://localhost:3000";
const AGENT = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:4100";

const raw = process.env.DEPLOYER_PRIVATE_KEY!.trim();
const provider = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`);
const pc = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const wc = createWalletClient({ account: provider, chain: baseSepolia, transport: http(RPC) });

// The fixed demo patient — same derivation the web app uses.
const patientId = "ramesh-kumar-1989";
const patientHash = keccak256(toHex(`lifescan:patient:${patientId}`));

const record = {
  name: "Ramesh Kumar", dob: "1989-03-14", bloodGroup: "O+",
  conditions: ["Type 2 diabetes mellitus", "Atrial fibrillation"],
  medications: [{ name: "Warfarin", dose: "5 mg", frequency: "once daily" }, { name: "Metformin", dose: "500 mg", frequency: "twice daily" }],
  allergies: [{ substance: "Penicillin", reaction: "Anaphylaxis", severity: "severe" }],
  implants: [{ type: "Pacemaker", model: "Medtronic Azure XT DR" }],
  emergencyContacts: [{ name: "Sunita Kumar", relation: "spouse", phone: "+919876543210" }],
  insurance: { provider: "Star Health", policyNo: "SH-4471-99213" },
};

async function main() {
  console.log(`patient ${patientId}\nhash    ${patientHash}\n`);

  const sealed = await sealRecord(record);
  for (let i = 0; i < GUARDIANS.length; i++) {
    await fetch(`${GUARDIANS[i]}/shares`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patientHash, share: sealed.shares[i] }) })
      .then((r) => { if (!r.ok && r.status !== 409) throw new Error(`guardian ${i + 1}: ${r.status}`); });
  }
  console.log("✓ sealed + distributed to guardians");

  await fetch(`${WEB}/api/records`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patientHash, ciphertext: sealed.ciphertext, label: "Ramesh Kumar · O+" }) });
  console.log("✓ ciphertext mirrored to web app");

  await fetch(`${AGENT}/context`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patientHash, context: "male ~35, road traffic accident, GCS 9, BP 90/60, team considering ceftriaxone" }) }).catch(() => {});
  console.log("✓ paramedic context handed to agent");

  if (!(await pc.readContract({ address: REGISTRY, abi: [{ type: "function", name: "isActive", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] }] as const, functionName: "isActive", args: [provider.address] }))) {
    await pc.waitForTransactionReceipt({ hash: await wc.writeContract({ address: REGISTRY, abi: [{ type: "function", name: "registerProvider", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "string" }, { type: "string" }], outputs: [] }] as const, functionName: "registerProvider", args: [provider.address, "HFR-MP-GWL-0042", "Dr. Sharma, Gwalior Trauma Centre"] }) });
    console.log("✓ provider registered");
  }

  const tx = await wc.writeContract({ address: ACCESS, abi: [{ type: "function", name: "requestBreakGlass", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "uint16" }, { type: "bytes32" }], outputs: [] }] as const, functionName: "requestBreakGlass", args: [patientHash, 2, zeroHash] });
  console.log(`\n🔴 BREAK GLASS fired: https://sepolia.basescan.org/tx/${tx}`);
  await pc.waitForTransactionReceipt({ hash: tx });
  console.log("✓ confirmed on-chain — the agent should now trigger on its own.\n");
  console.log("   Watch: http://localhost:3000/er");
}

main().catch((e) => { console.error(e); process.exit(1); });
