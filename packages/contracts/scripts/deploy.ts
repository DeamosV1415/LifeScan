import hre from "hardhat";
import fs from "node:fs";
import path from "node:path";
import { formatEther, getAddress, isAddress } from "viem";

/**
 * Deploys the four LifeScan contracts and records their addresses.
 *
 * Order matters: EmergencyAccessLog takes the registry address and
 * EmergencyEscrow takes the agent log address, both in their constructors.
 *
 * Role wiring is deliberately conditional. The provider, agent, and approver
 * are distinct real identities that do not exist yet (the provider is a Privy
 * wallet created in Phase 2, the agent is a service key from Phase 3). Rather
 * than silently registering the deployer as all three — which would make the
 * agent/human boundary meaningless — we wire only what has been configured and
 * print what is still missing.
 */

const ENV_PATH = path.resolve(__dirname, "../../../.env.local");

function optionalAddress(name: string): `0x${string}` | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;

  if (!isAddress(raw)) {
    throw new Error(`${name} is set but is not a valid address: ${raw}`);
  }
  return getAddress(raw);
}

/** Upsert keys into .env.local without disturbing anything already there. */
function writeEnv(entries: Record<string, string>) {
  let contents = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";

  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");

    contents = pattern.test(contents)
      ? contents.replace(pattern, line)
      : `${contents.trimEnd()}\n${line}\n`;
  }

  fs.writeFileSync(ENV_PATH, contents.startsWith("\n") ? contents.trimStart() : contents);
}

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const balance = await publicClient.getBalance({ address: deployer.account.address });

  console.log(`\nnetwork   ${hre.network.name}`);
  console.log(`deployer  ${deployer.account.address}`);
  console.log(`balance   ${formatEther(balance)} ETH\n`);

  if (balance === 0n) {
    throw new Error("Deployer has no ETH. Fund it before deploying.");
  }

  console.log("deploying ProviderRegistry...");
  const registry = await hre.viem.deployContract("ProviderRegistry");
  console.log(`  ${registry.address}`);

  console.log("deploying EmergencyAccessLog...");
  const accessLog = await hre.viem.deployContract("EmergencyAccessLog", [registry.address]);
  console.log(`  ${accessLog.address}`);

  console.log("deploying AgentActionLog...");
  const agentLog = await hre.viem.deployContract("AgentActionLog");
  console.log(`  ${agentLog.address}`);

  console.log("deploying EmergencyEscrow...");
  const escrow = await hre.viem.deployContract("EmergencyEscrow", [agentLog.address]);
  console.log(`  ${escrow.address}\n`);

  // --- Role wiring, only where an identity actually exists yet ---

  const providerAddress = optionalAddress("DEMO_PROVIDER_ADDRESS");
  const agentAddress = optionalAddress("AGENT_ADDRESS");
  const approverAddress = optionalAddress("HUMAN_APPROVER_ADDRESS");
  const pending: string[] = [];

  if (providerAddress) {
    await registry.write.registerProvider([
      providerAddress,
      "HFR-MP-GWL-0042",
      "Dr. Sharma, Gwalior Trauma Centre",
    ]);
    console.log(`registered provider  ${providerAddress}`);
  } else {
    pending.push("DEMO_PROVIDER_ADDRESS  (Privy wallet — Phase 2)");
  }

  if (agentAddress) {
    await agentLog.write.authorizeAgent([agentAddress]);
    console.log(`authorized agent     ${agentAddress}`);
  } else {
    pending.push("AGENT_ADDRESS          (agent service key — Phase 3)");
  }

  if (approverAddress) {
    await escrow.write.addApprover([approverAddress]);
    console.log(`added approver       ${approverAddress}`);
  } else {
    pending.push("HUMAN_APPROVER_ADDRESS (must NOT be the agent — Phase 4)");
  }

  writeEnv({
    NEXT_PUBLIC_REGISTRY_ADDRESS: registry.address,
    NEXT_PUBLIC_ACCESS_LOG_ADDRESS: accessLog.address,
    NEXT_PUBLIC_AGENT_LOG_ADDRESS: agentLog.address,
    NEXT_PUBLIC_ESCROW_ADDRESS: escrow.address,
    NEXT_PUBLIC_CHAIN_ID: String(await publicClient.getChainId()),
  });

  console.log(`\naddresses written to .env.local`);

  if (pending.length > 0) {
    console.log("\nroles still to wire (run scripts/wire.ts once these exist):");
    for (const item of pending) console.log(`  - ${item}`);
  }

  if (hre.network.name === "baseSepolia") {
    console.log("\nverify on Basescan:");
    console.log(`  npx hardhat verify --network baseSepolia ${registry.address}`);
    console.log(
      `  npx hardhat verify --network baseSepolia ${accessLog.address} ${registry.address}`,
    );
    console.log(`  npx hardhat verify --network baseSepolia ${agentLog.address}`);
    console.log(
      `  npx hardhat verify --network baseSepolia ${escrow.address} ${agentLog.address}`,
    );
    console.log(`\nexplorer: https://sepolia.basescan.org/address/${accessLog.address}`);
  }

  const spent = balance - (await publicClient.getBalance({ address: deployer.account.address }));
  console.log(`\ngas spent ${formatEther(spent)} ETH\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
