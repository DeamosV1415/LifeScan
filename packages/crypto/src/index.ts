/**
 * @lifescan/crypto — the Tier-1 sealing scheme.
 *
 * The whole break-glass trust model in two functions:
 *
 *   sealRecord   runs in the patient's browser. Generates a one-time key,
 *                encrypts the clinical record, splits the key three ways, and
 *                forgets the key. The plaintext never leaves the device.
 *
 *   openRecord   runs in the provider's browser after a break-glass grant,
 *                using two shares released by two independent Guardians.
 *
 * Nowhere in this system does any single party hold a key that opens a record.
 * That is a property of the code, not a policy promise.
 */

export { generateDek, encrypt, decrypt } from "./aes.ts";
export { split, combine } from "./shamir.ts";
export { toHex, fromHex } from "./hex.ts";

import { decrypt, encrypt, generateDek } from "./aes.ts";
import { combine, split } from "./shamir.ts";
import { fromHex, toHex } from "./hex.ts";

export const GUARDIAN_COUNT = 3;
export const GUARDIAN_THRESHOLD = 2;

export interface SealedRecord {
  /** AES-256-GCM payload (iv || ciphertext || tag), hex encoded. */
  ciphertext: string;
  /** One share per Guardian, hex encoded, in Guardian order. */
  shares: string[];
}

/** Encrypt a record and split its key across the Guardian set. */
export async function sealRecord(record: unknown): Promise<SealedRecord> {
  const dek = generateDek();

  try {
    const ciphertext = await encrypt(dek, JSON.stringify(record));
    const shares = split(dek, {
      shares: GUARDIAN_COUNT,
      threshold: GUARDIAN_THRESHOLD,
    });

    return {
      ciphertext: toHex(ciphertext),
      shares: shares.map(toHex),
    };
  } finally {
    // Best-effort scrub. JS gives no guarantee the bytes are gone from memory,
    // but leaving a live reference to a reconstructable key would be careless.
    dek.fill(0);
  }
}

/** Reconstruct the key from any two shares and decrypt the record. */
export async function openRecord<T = unknown>(
  ciphertext: string,
  shares: string[],
): Promise<T> {
  if (shares.length < GUARDIAN_THRESHOLD) {
    throw new Error(
      `crypto: need ${GUARDIAN_THRESHOLD} shares to open a record, got ${shares.length}`,
    );
  }

  const dek = combine(shares.map(fromHex));

  try {
    return JSON.parse(await decrypt(dek, fromHex(ciphertext))) as T;
  } finally {
    dek.fill(0);
  }
}
