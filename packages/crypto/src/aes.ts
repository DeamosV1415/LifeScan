/**
 * AES-256-GCM over WebCrypto.
 *
 * WebCrypto is present in browsers and in Node 18+, so the identical code path
 * runs in the patient's browser (where the record is encrypted and the
 * plaintext never leaves the device) and in the Guardian services.
 *
 * We use GCM rather than CBC because it is authenticated: a tampered
 * ciphertext fails to decrypt rather than yielding plausible garbage. For a
 * medical record, silently-corrupted plaintext is a patient-safety issue, not
 * just a correctness one.
 */

const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const KEY_BITS = 256;

/** Generate a fresh data encryption key. This is what gets Shamir-split. */
export function generateDek(): Uint8Array {
  const key = new Uint8Array(KEY_BITS / 8);
  crypto.getRandomValues(key);
  return key;
}

async function importKey(dek: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  if (dek.length !== KEY_BITS / 8) {
    throw new Error(`aes: key must be ${KEY_BITS / 8} bytes, got ${dek.length}`);
  }
  return crypto.subtle.importKey("raw", dek, { name: "AES-GCM" }, false, [usage]);
}

/**
 * Encrypt a UTF-8 string. Returns iv || ciphertext, where the GCM
 * authentication tag is appended to the ciphertext by WebCrypto.
 */
export async function encrypt(dek: Uint8Array, plaintext: string): Promise<Uint8Array> {
  const key = await importKey(dek, "encrypt");

  // A fresh IV per encryption is mandatory. Reusing an IV under the same key
  // in GCM is catastrophic — it leaks the XOR of the plaintexts and the
  // authentication subkey.
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );

  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv, 0);
  out.set(ciphertext, iv.length);
  return out;
}

/** Decrypt a payload produced by `encrypt`. Throws if the data was tampered with. */
export async function decrypt(dek: Uint8Array, payload: Uint8Array): Promise<string> {
  if (payload.length <= IV_BYTES) {
    throw new Error("aes: payload too short to contain an IV and ciphertext");
  }

  const key = await importKey(dek, "decrypt");
  const iv = payload.subarray(0, IV_BYTES);
  const ciphertext = payload.subarray(IV_BYTES);

  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
