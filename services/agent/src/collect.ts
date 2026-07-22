import { openRecord } from "@lifescan/crypto";
import type { AgentChain } from "./chain.ts";

/**
 * Collect key shares as the authorised agent and decrypt the record.
 *
 * Mirrors the provider's collection, but hits each Guardian's /release-agent
 * path: the Guardian checks the agent is authorised on-chain and that a real
 * grant exists, then releases. Two shares reconstruct the key; the agent holds
 * it only for the moment it takes to decrypt, in memory, and never persists it.
 */

function challengeMessage(patientHash: string, nonce: string): string {
  return `LifeScan break-glass\npatient: ${patientHash}\nnonce: ${nonce}`;
}

export async function collectAndDecrypt(params: {
  chain: AgentChain;
  guardianUrls: string[];
  patientHash: `0x${string}`;
  ciphertext: string;
  threshold: number;
}): Promise<unknown> {
  const { chain, guardianUrls, patientHash, ciphertext, threshold } = params;
  const shares: string[] = [];

  for (const url of guardianUrls) {
    if (shares.length >= threshold) break;
    try {
      const { nonce } = await (await fetch(`${url}/challenge`)).json();
      const signature = await chain.signChallenge(challengeMessage(patientHash, nonce));

      const res = await fetch(`${url}/release-agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patientHash, agent: chain.agentAddress, nonce, signature }),
      });
      const body = await res.json();
      if (body.released) shares.push(body.share);
    } catch {
      // Try the next Guardian; a threshold scheme tolerates one being down.
    }
  }

  if (shares.length < threshold) {
    throw new Error(`only ${shares.length} of ${threshold} shares released — cannot decrypt`);
  }

  return openRecord(ciphertext, shares);
}
