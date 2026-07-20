import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import dotenv from "dotenv";
import path from "node:path";

// Secrets live in the repo-root .env.local, which is gitignored.
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

/**
 * MetaMask exports private keys without the 0x prefix; most other tools include
 * it. Accept either rather than making the key's exact shape a deploy-day
 * failure mode.
 */
function normalizeKey(key: string | undefined): string[] {
  if (!key) return [];

  const trimmed = key.trim();
  const prefixed = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(prefixed)) {
    throw new Error(
      "DEPLOYER_PRIVATE_KEY is not a valid 32-byte hex key. " +
        "Expected 64 hex characters (a 42-character value is an address, not a key).",
    );
  }

  return [prefixed];
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      chainId: 84532,
      accounts: normalizeKey(process.env.DEPLOYER_PRIVATE_KEY),
    },
  },
  etherscan: {
    // Etherscan's unified multichain API covers Base, so one key serves all.
    apiKey: {
      baseSepolia: process.env.BASESCAN_API_KEY ?? "",
    },
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
};

export default config;
