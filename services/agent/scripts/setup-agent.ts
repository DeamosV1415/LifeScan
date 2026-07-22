/**
 * One-time agent setup, run with the deployer key.
 *
 * Generates the agent's own identity, funds it with a little gas from the
 * deployer, and authorizes it on-chain via AgentActionLog.authorizeAgent
 * (admin-only; the deployer is admin). Writes AGENT_PRIVATE_KEY and
 * AGENT_ADDRESS back to .env.local. Idempotent — re-running reuses the key and
 * only tops up gas / re-authorizes if needed.
 *
 * The agent gets its own key, distinct from the provider, precisely so the
 * "agent cannot move money / agent is separately accountable" boundary is real.
 */

import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, formatEther, parseEther } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const ENV_PATH = path.resolve(import.meta.dirname, "../../../.env.local");

for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const AGENT_LOG_ABI = [
  { type: "function", name: "authorizeAgent", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] },
  { type: "function", name: "isAgent", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
] as const;

const GAS_TARGET = parseEther("0.002"); // plenty for many logAction txs on an L2

function writeEnv(entries: Record<string, string>) {
  let contents = fs.readFileSync(ENV_PATH, "utf8");
  for (const [key, value] of Object.entries(entries)) {
    const pattern = new RegExp(`^${key}=.*$`, "m");
    contents = pattern.test(contents)
      ? contents.replace(pattern, `${key}=${value}`)
      : `${contents.trimEnd()}\n${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, contents);
}

async function main() {
  const rpc = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
  const agentLog = process.env.NEXT_PUBLIC_AGENT_LOG_ADDRESS as `0x${string}`;
  if (!agentLog) throw new Error("NEXT_PUBLIC_AGENT_LOG_ADDRESS not set — deploy contracts first.");

  const rawDeployer = process.env.DEPLOYER_PRIVATE_KEY!.trim();
  const deployer = privateKeyToAccount((rawDeployer.startsWith("0x") ? rawDeployer : `0x${rawDeployer}`) as `0x${string}`);

  // Reuse an existing agent key, or mint one.
  let agentKey = process.env.AGENT_PRIVATE_KEY?.trim();
  if (!agentKey) {
    agentKey = generatePrivateKey();
    console.log("generated a new agent key");
  }
  const agent = privateKeyToAccount((agentKey.startsWith("0x") ? agentKey : `0x${agentKey}`) as `0x${string}`);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  const wallet = createWalletClient({ account: deployer, chain: baseSepolia, transport: http(rpc) });

  console.log(`deployer ${deployer.address}`);
  console.log(`agent    ${agent.address}`);

  // Fund the agent up to the gas target.
  const balance = await publicClient.getBalance({ address: agent.address });
  if (balance < GAS_TARGET) {
    const topUp = GAS_TARGET - balance;
    const tx = await wallet.sendTransaction({ to: agent.address, value: topUp });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log(`funded agent with ${formatEther(topUp)} ETH`);
  } else {
    console.log(`agent already funded (${formatEther(balance)} ETH)`);
  }

  // Authorize on-chain.
  const already = await publicClient.readContract({ address: agentLog, abi: AGENT_LOG_ABI, functionName: "isAgent", args: [agent.address] });
  if (already) {
    console.log("agent already authorized on-chain");
  } else {
    const tx = await wallet.writeContract({ address: agentLog, abi: AGENT_LOG_ABI, functionName: "authorizeAgent", args: [agent.address] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log("authorized agent on-chain");
  }

  writeEnv({ AGENT_PRIVATE_KEY: agentKey, AGENT_ADDRESS: agent.address });
  console.log("wrote AGENT_PRIVATE_KEY and AGENT_ADDRESS to .env.local");
}

main().catch((e) => { console.error(e); process.exit(1); });
