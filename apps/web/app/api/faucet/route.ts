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

export async function POST(req: NextRequest) {
  if (process.env.FAUCET_ENABLED === "false") {
    return NextResponse.json({ error: "Faucet is disabled." }, { status: 503 });
  }

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

    const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });
    const txHash = await wallet.sendTransaction({ to: target, value: FUND_AMOUNT });
    await pub.waitForTransactionReceipt({ hash: txHash });

    const newBal = await pub.getBalance({ address: target });
    return NextResponse.json({ ok: true, txHash, balance: formatEther(newBal) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "faucet transfer failed" },
      { status: 500 },
    );
  }
}
