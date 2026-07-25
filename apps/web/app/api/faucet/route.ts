import { NextRequest, NextResponse } from "next/server";
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
import { rateLimit, clientIp, tooMany, envLimit } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";

/**
 * Demo faucet — tops up an empty Privy wallet so a patient can claim their
 * record and a provider can break glass. Privy mints wallets with no ETH, and
 * both actions need a few millionths of an ETH of gas on Base L2.
 *
 * Deliberately bounded so it can't be used to drain the deployer:
 *  - refuses if the wallet already holds >= FUND_SKIP_ABOVE (so one address
 *    gets topped up once, not repeatedly),
 *  - sends a small fixed amount,
 *  - refuses if the deployer itself is low,
 *  - can be switched off entirely with FAUCET_ENABLED=false.
 *
 * The deployer key signs server-side and never reaches the browser.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
// A few thousandths of an ETH is thousands of L2 transactions; 0.001 keeps the
// shared deployer comfortable across many demo wallets.
const FUND_AMOUNT = parseEther("0.001");
const FUND_SKIP_ABOVE = parseEther("0.0005");

// Ceiling on how many DISTINCT wallets the faucet will newly fund in a day.
// The per-address skip means a real user only ever draws once, so this bounds
// the total daily drain (default 50 × 0.001 = 0.05 ETH) even against an
// attacker minting fresh addresses from many IPs. Env-tunable for a big crowd.
const DAY_CAP = Number(process.env.RL_FAUCET_DAY_CAP) > 0 ? Number(process.env.RL_FAUCET_DAY_CAP) : 50;

/** Reserve one slot against today's global cap; returns false when exhausted. */
async function withinDailyCap(): Promise<boolean> {
  const r = redis();
  if (!r) return true; // No shared store (local dev) — the per-IP limit suffices.
  const day = new Date().toISOString().slice(0, 10); // UTC yyyy-mm-dd
  const key = `faucet:daycap:${day}`;
  const count = await r.incr(key);
  if (count === 1) await r.expire(key, 172_800); // keep 2 days, self-expiring
  return count <= DAY_CAP;
}

export async function POST(req: NextRequest) {
  if (process.env.FAUCET_ENABLED === "false") {
    return NextResponse.json({ error: "Faucet is disabled." }, { status: 503 });
  }

  // Per-IP throttle first — cheapest rejection, and the primary abuse control.
  const rl = await rateLimit("faucet", clientIp(req), envLimit("FAUCET", { limit: 3, windowSec: 60 }));
  if (!rl.ok) return tooMany(rl);

  const body = await req.json().catch(() => null);
  if (!body || typeof body.address !== "string" || !isAddress(body.address)) {
    return NextResponse.json({ error: "address must be a valid wallet address" }, { status: 400 });
  }
  const target = getAddress(body.address);

  const key = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "Faucet is not configured on the server." }, { status: 503 });
  }

  try {
    const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
    const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

    const targetBal = await pub.getBalance({ address: target });
    if (targetBal >= FUND_SKIP_ABOVE) {
      return NextResponse.json({
        ok: true,
        already: true,
        balance: formatEther(targetBal),
        message: "Wallet already has enough gas.",
      });
    }

    const deployerBal = await pub.getBalance({ address: account.address });
    if (deployerBal < FUND_AMOUNT) {
      return NextResponse.json(
        { error: "Faucet is empty — the deployer needs a top-up." },
        { status: 503 },
      );
    }

    // Global daily ceiling — reserved only now that we know we'll actually send
    // (an already-funded or empty-deployer request never consumes a slot).
    if (!(await withinDailyCap())) {
      return NextResponse.json(
        { error: "Faucet daily limit reached — try again tomorrow." },
        { status: 429 },
      );
    }

    const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });
    const txHash = await wallet.sendTransaction({ to: target, value: FUND_AMOUNT });
    await pub.waitForTransactionReceipt({ hash: txHash });

    const newBal = await pub.getBalance({ address: target });
    return NextResponse.json({ ok: true, txHash, balance: formatEther(newBal) });
  } catch (e) {
    // Log the detail server-side; return a generic message so a prober can't
    // read back the RPC URL, key state, or other internals.
    console.error("[faucet]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Faucet transfer failed." }, { status: 500 });
  }
}
