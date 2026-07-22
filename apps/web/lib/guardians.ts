import { openRecord } from "@lifescan/crypto";
import type { Tier1Record } from "./record";

/**
 * The browser's view of the Guardian network.
 *
 * Two operations mirror the two ends of a record's life:
 *   distributeShares  — patient app, at seal time: hand each Guardian its share
 *   collectShares     — provider app, at break-glass: gather any two back
 *
 * The provider never asks all three; two is the threshold, and stopping at two
 * is deliberate — it proves on stage that no single Guardian is load-bearing.
 */

export interface GuardianEndpoint {
  id: string;
  url: string;
}

export function guardianEndpoints(): GuardianEndpoint[] {
  // Comma-separated in one env var so adding/moving Guardians is a config change.
  // e.g. "http://localhost:4001,http://localhost:4002,http://localhost:4003"
  const raw = process.env.NEXT_PUBLIC_GUARDIAN_URLS ?? "";
  const urls = raw.split(",").map((u) => u.trim()).filter(Boolean);

  return urls.map((url, i) => ({ id: String(i + 1), url }));
}

/** Hand each Guardian exactly one share. All must accept for the seal to hold. */
export async function distributeShares(
  patientHash: `0x${string}`,
  shares: string[],
): Promise<void> {
  const guardians = guardianEndpoints();

  if (guardians.length !== shares.length) {
    throw new Error(
      `Have ${shares.length} shares but ${guardians.length} guardians configured.`,
    );
  }

  await Promise.all(
    guardians.map(async (guardian, i) => {
      const res = await fetch(`${guardian.url}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patientHash, share: shares[i] }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          `Guardian ${guardian.id} rejected its share: ${body.error ?? res.status}`,
        );
      }
    }),
  );
}

export interface CollectResult {
  shares: string[];
  /** Which Guardians released, for the on-screen trace. */
  releasedBy: string[];
  /** Which refused and why — surfaced rather than hidden. */
  refusals: { id: string; reason: string }[];
}

/**
 * Gather shares from the Guardians, stopping as soon as the threshold is met.
 *
 * `signChallenge` is supplied by the caller — it is the provider's embedded
 * wallet signing each Guardian's fresh nonce, proving liveness. We never see or
 * hold the key; we just hand each Guardian a signature over its own challenge.
 */
export async function collectShares(params: {
  patientHash: `0x${string}`;
  provider: `0x${string}`;
  threshold: number;
  signChallenge: (message: string) => Promise<`0x${string}`>;
}): Promise<CollectResult> {
  const { patientHash, provider, threshold, signChallenge } = params;
  const guardians = guardianEndpoints();

  const shares: string[] = [];
  const releasedBy: string[] = [];
  const refusals: { id: string; reason: string }[] = [];

  // Sequential rather than parallel: we want to stop the instant we hit the
  // threshold, and on stage the one-at-a-time reveal reads clearly.
  for (const guardian of guardians) {
    if (shares.length >= threshold) break;

    try {
      const challengeRes = await fetch(`${guardian.url}/challenge`);
      const { nonce } = await challengeRes.json();

      const message = challengeMessage(patientHash, nonce);
      const signature = await signChallenge(message);

      const releaseRes = await fetch(`${guardian.url}/release`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patientHash, provider, nonce, signature }),
      });

      const body = await releaseRes.json();

      if (releaseRes.ok && body.released) {
        shares.push(body.share);
        releasedBy.push(guardian.id);
      } else {
        refusals.push({ id: guardian.id, reason: body.reason ?? `HTTP ${releaseRes.status}` });
      }
    } catch (error) {
      refusals.push({
        id: guardian.id,
        reason: error instanceof Error ? error.message : "unreachable",
      });
    }
  }

  return { shares, releasedBy, refusals };
}

/**
 * The exact string a Guardian expects the provider to sign. MUST match the
 * Guardian's challengeMessage byte-for-byte, or every signature check fails.
 */
export function challengeMessage(patientHash: string, nonce: string): string {
  return `LifeScan break-glass\npatient: ${patientHash}\nnonce: ${nonce}`;
}

/** Reconstruct and decrypt once the threshold of shares is in hand. */
export async function decryptRecord(
  ciphertext: string,
  shares: string[],
): Promise<Tier1Record> {
  return openRecord<Tier1Record>(ciphertext, shares);
}
