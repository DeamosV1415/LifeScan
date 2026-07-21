import path from "node:path";
import dotenv from "dotenv";
import { createChainReader } from "./chain.ts";
import { createGuardianServer } from "./server.ts";
import { createNonceStore, createShareStore } from "./store.ts";

dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env.local") });

/**
 * One Guardian process.
 *
 * GUARDIAN_ID selects which of the three this is, which decides its port and
 * its share file. The three are identical code with separate state — that is
 * the point. In production they are operated by a hospital federation, a state
 * health authority, and an independent auditor; today all three are ours, and
 * the architecture does not change when they are not.
 */

const id = process.env.GUARDIAN_ID ?? "1";
const port = Number(process.env.PORT ?? 4000 + Number(id));

const accessLogAddress = process.env.NEXT_PUBLIC_ACCESS_LOG_ADDRESS;
if (!accessLogAddress) {
  throw new Error(
    "NEXT_PUBLIC_ACCESS_LOG_ADDRESS is not set — run the contract deploy first.",
  );
}

const chain = createChainReader({
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
  accessLogAddress: accessLogAddress as `0x${string}`,
});

const shares = createShareStore(
  process.env.GUARDIAN_STORE ?? path.resolve(import.meta.dirname, `../data/guardian-${id}.json`),
);

const server = createGuardianServer({
  id,
  chain,
  shares,
  nonces: createNonceStore(),
});

server.listen(port, () => {
  console.log(`[guardian ${id}] listening on :${port} — holds ${shares.count()} share(s)`);
  console.log(`[guardian ${id}] verifying against ${accessLogAddress} on Base Sepolia`);
});
