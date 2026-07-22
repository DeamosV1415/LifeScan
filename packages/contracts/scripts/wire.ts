import hre from "hardhat";
import { getAddress, isAddress } from "viem";

/**
 * Wire on-chain roles after the identities exist.
 *
 * The provider and agent addresses are Privy/embedded wallets that only exist
 * once someone has logged in, so they cannot be set at deploy time. Run this
 * once those addresses are known:
 *
 *   DEMO_PROVIDER_ADDRESS=0x… AGENT_ADDRESS=0x… HUMAN_APPROVER_ADDRESS=0x… \
 *     pnpm --filter @lifescan/contracts wire:baseSepolia
 *
 * Idempotent: each role is checked before it is set, so re-running is safe and
 * cheap. This is admin-only — it must be run with the deployer key.
 */

function addr(name: string): `0x${string}` | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  if (!isAddress(raw)) throw new Error(`${name} is not a valid address: ${raw}`);
  return getAddress(raw);
}

async function main() {
  const registry = await hre.viem.getContractAt(
    "ProviderRegistry",
    requireEnv("NEXT_PUBLIC_REGISTRY_ADDRESS"),
  );
  const agentLog = await hre.viem.getContractAt(
    "AgentActionLog",
    requireEnv("NEXT_PUBLIC_AGENT_LOG_ADDRESS"),
  );
  const escrow = await hre.viem.getContractAt(
    "EmergencyEscrow",
    requireEnv("NEXT_PUBLIC_ESCROW_ADDRESS"),
  );

  const provider = addr("DEMO_PROVIDER_ADDRESS");
  const agent = addr("AGENT_ADDRESS");
  const approver = addr("HUMAN_APPROVER_ADDRESS");

  if (provider) {
    if (await registry.read.isActive([provider])) {
      console.log(`provider ${provider} already active — skipped`);
    } else {
      await registry.write.registerProvider([
        provider,
        "HFR-MP-GWL-0042",
        "Dr. Sharma, Gwalior Trauma Centre",
      ]);
      console.log(`registered provider ${provider}`);
    }
  }

  if (agent) {
    if (await agentLog.read.isAgent([agent])) {
      console.log(`agent ${agent} already authorized — skipped`);
    } else {
      await agentLog.write.authorizeAgent([agent]);
      console.log(`authorized agent ${agent}`);
    }
  }

  if (approver) {
    if (await escrow.read.isHumanApprover([approver])) {
      console.log(`approver ${approver} already added — skipped`);
    } else {
      await escrow.write.addApprover([approver]);
      console.log(`added approver ${approver}`);
    }
  }

  if (!provider && !agent && !approver) {
    console.log("Nothing to wire. Set DEMO_PROVIDER_ADDRESS / AGENT_ADDRESS / HUMAN_APPROVER_ADDRESS.");
  }
}

function requireEnv(name: string): `0x${string}` {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — run the deploy first.`);
  return value as `0x${string}`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
