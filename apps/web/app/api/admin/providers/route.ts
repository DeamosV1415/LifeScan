import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { REGISTRY_ABI } from "@/lib/contracts";

/**
 * Hospital onboarding — the admin side of "email is the doorknob, the registry
 * is the lock". A Privy email login mints a wallet with zero authority; only an
 * entry here (bound to an HFR/HPR facility ID) makes an address a real clinician
 * who can break glass. That is why this endpoint exists and why it is gated.
 *
 *   GET  /api/admin/providers          public read — enumerate the registry
 *   POST /api/admin/providers          admin-only — register / revoke / reinstate
 *
 * Trust model, deliberately:
 *  - The GET is public because the registry roster is not secret; it is exactly
 *    the transparency the pitch promises. The reads go straight to the chain.
 *  - The POST is signed SERVER-SIDE with the deployer (admin) key, which never
 *    leaves the server — it is not a NEXT_PUBLIC_* var and never reaches the
 *    browser. A caller cannot self-register: they must present the shared
 *    ADMIN_TOKEN, checked below. Without ADMIN_TOKEN set, every write is refused.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

function registryAddress(): `0x${string}` {
  const addr = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS;
  if (!addr || !isAddress(addr)) {
    throw new Error("NEXT_PUBLIC_REGISTRY_ADDRESS is not set or invalid.");
  }
  return getAddress(addr);
}

function publicClient() {
  return createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
}

interface ProviderRow {
  address: `0x${string}`;
  hfrId: string;
  name: string;
  active: boolean;
  registeredAt: number;
}

export async function GET() {
  try {
    const client = publicClient();
    const registry = registryAddress();

    const [admin, count] = await Promise.all([
      client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "admin" }),
      client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "providerCount" }),
    ]);

    const n = Number(count);
    const addresses = (await Promise.all(
      Array.from({ length: n }, (_, i) =>
        client.readContract({
          address: registry,
          abi: REGISTRY_ABI,
          functionName: "providerAt",
          args: [BigInt(i)],
        }),
      ),
    )) as `0x${string}`[];

    const providers: ProviderRow[] = await Promise.all(
      addresses.map(async (address) => {
        const p = (await client.readContract({
          address: registry,
          abi: REGISTRY_ABI,
          functionName: "getProvider",
          args: [address],
        })) as { hfrId: string; name: string; active: boolean; registeredAt: bigint };
        return {
          address,
          hfrId: p.hfrId,
          name: p.name,
          active: p.active,
          registeredAt: Number(p.registeredAt),
        };
      }),
    );

    // Newest registration first; the roster reads like an activity log.
    providers.sort((a, b) => b.registeredAt - a.registeredAt);

    return NextResponse.json({
      admin,
      registry,
      writesEnabled: Boolean(process.env.ADMIN_TOKEN),
      providers,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to read registry" },
      { status: 500 },
    );
  }
}

type Action = "register" | "revoke" | "reinstate";
const ACTIONS: Action[] = ["register", "revoke", "reinstate"];

export async function POST(req: NextRequest) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Admin writes are disabled: set ADMIN_TOKEN in the server env." },
      { status: 503 },
    );
  }

  // Constant-ish equality — the token is short-lived demo config, but never
  // echo it back and always compare against the header, not a query param.
  const presented = req.headers.get("x-admin-token") ?? "";
  if (presented !== expected) {
    return NextResponse.json({ error: "Admin token rejected." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !ACTIONS.includes(body.action)) {
    return NextResponse.json(
      { error: `action must be one of ${ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }
  const action = body.action as Action;

  if (typeof body.provider !== "string" || !isAddress(body.provider)) {
    return NextResponse.json({ error: "provider must be a valid address" }, { status: 400 });
  }
  const provider = getAddress(body.provider);

  let hfrId = "";
  let name = "";
  if (action === "register") {
    hfrId = typeof body.hfrId === "string" ? body.hfrId.trim() : "";
    name = typeof body.name === "string" ? body.name.trim() : "";
    if (!hfrId || !name) {
      return NextResponse.json(
        { error: "register needs both hfrId and name" },
        { status: 400 },
      );
    }
  }

  const key = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!key) {
    return NextResponse.json(
      { error: "DEPLOYER_PRIVATE_KEY is not set on the server." },
      { status: 503 },
    );
  }

  try {
    const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
    const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });
    const client = publicClient();
    const registry = registryAddress();

    // Guard rails so a fat-fingered click returns a clean message instead of a
    // raw revert: don't re-register an active provider, don't revoke one who is
    // already inactive, don't reinstate one who is already active.
    const existing = (await client.readContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "getProvider",
      args: [provider],
    })) as { hfrId: string; name: string; active: boolean; registeredAt: bigint };
    const isRegistered = Number(existing.registeredAt) > 0;

    if (action === "register" && existing.active) {
      return NextResponse.json({ error: "That address is already an active provider." }, { status: 409 });
    }
    if (action === "revoke" && (!isRegistered || !existing.active)) {
      return NextResponse.json({ error: "That address is not an active provider." }, { status: 409 });
    }
    if (action === "reinstate" && (!isRegistered || existing.active)) {
      return NextResponse.json({ error: "That address is not a revoked provider." }, { status: 409 });
    }

    let txHash: `0x${string}`;
    if (action === "register") {
      txHash = await wallet.writeContract({
        address: registry,
        abi: REGISTRY_ABI,
        functionName: "registerProvider",
        args: [provider, hfrId, name],
      });
    } else if (action === "revoke") {
      txHash = await wallet.writeContract({
        address: registry,
        abi: REGISTRY_ABI,
        functionName: "revokeProvider",
        args: [provider],
      });
    } else {
      txHash = await wallet.writeContract({
        address: registry,
        abi: REGISTRY_ABI,
        functionName: "reinstateProvider",
        args: [provider],
      });
    }

    await client.waitForTransactionReceipt({ hash: txHash });
    return NextResponse.json({ ok: true, action, provider, txHash });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "transaction failed";
    // Surface the contract's own vocabulary if it reverted.
    const friendly = /NotAdmin/.test(msg)
      ? "The server's key is not the registry admin."
      : /AlreadyRegistered/.test(msg)
        ? "That address is already registered."
        : /NotRegistered/.test(msg)
          ? "That address is not registered."
          : /ZeroAddress/.test(msg)
            ? "Address cannot be zero."
            : msg;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}
