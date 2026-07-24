import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  isAddress,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

/**
 * Fund a demo wallet from the deployer key.
 *
 * Privy embedded wallets are created empty, so a patient can't claim their
 * record and a provider can't break glass until their wallet holds a little
 * Base Sepolia ETH for gas. This tops one up from the deployer (which was
 * funded on day 0). Gas on an L2 is negligible — a few thousandths of an ETH
 * covers dozens of transactions.
 *
 *   pnpm --filter @lifescan/agent fund <0xAddress> [amountEth=0.003]
 */

// Load repo-root .env.local (same loader the agent uses).
for (const line of fs.readFileSync(path.resolve(import.meta.dirname, "../../../.env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const target = process.argv[2];
const amountEth = process.argv[3] ?? "0.003";

if (!target || !isAddress(target)) {
  console.error("Usage: pnpm --filter @lifescan/agent fund <0xAddress> [amountEth=0.003]");
  process.exit(1);
}

const rpc = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const key = process.env.DEPLOYER_PRIVATE_KEY?.trim();
if (!key) {
  console.error("DEPLOYER_PRIVATE_KEY is not set in .env.local");
  process.exit(1);
}

const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });
const pub = createPublicClient({ chain: baseSepolia, transport: http(rpc) });

const to = getAddress(target);
const deployerBal = await pub.getBalance({ address: account.address });
console.log(`deployer ${account.address} holds ${formatEther(deployerBal)} ETH`);

if (deployerBal < parseEther(amountEth)) {
  console.error(`deployer balance is below ${amountEth} ETH — top up the deployer first.`);
  process.exit(1);
}

console.log(`sending ${amountEth} ETH -> ${to} …`);
const hash = await wallet.sendTransaction({ to, value: parseEther(amountEth) });
console.log(`tx ${hash}`);
await pub.waitForTransactionReceipt({ hash });

const newBal = await pub.getBalance({ address: to });
console.log(`done — ${to} now holds ${formatEther(newBal)} ETH`);
console.log(`https://sepolia.basescan.org/tx/${hash}`);
