import { scrypt, randomBytes, randomInt, timingSafeEqual, createHash, type ScryptOptions } from "node:crypto";

/**
 * PIN + OTP hashing for the card lock.
 *
 * A card PIN is short and low-entropy by design (it must be memorable), so the
 * real protection is the server-side lockout in the verify route — but we still
 * never store the PIN itself. scrypt (from node:crypto, no native dependency,
 * so it builds cleanly on Vercel's serverless runtime where native argon2 is
 * painful) with a per-PIN random salt makes an offline guess of a leaked hash
 * expensive, and timingSafeEqual keeps the compare constant-time.
 */

const KEYLEN = 32;
// scrypt cost — N=2^15 is a good interactive-latency/strength balance and keeps
// a serverless invocation well under its time budget.
const PARAMS: ScryptOptions = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// Wrapped by hand rather than promisify(scrypt) so we can pass the cost options
// (promisify's typing drops the options overload).
function scryptAsync(password: string, salt: string, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, PARAMS, (err, dk) => (err ? reject(err) : resolve(dk)));
  });
}

export interface PinHash {
  hash: string;
  salt: string;
}

export async function hashPin(pin: string): Promise<PinHash> {
  const salt = randomBytes(16).toString("hex");
  const dk = await scryptAsync(pin, salt, KEYLEN);
  return { hash: dk.toString("hex"), salt };
}

export async function verifyPin(pin: string, stored: PinHash): Promise<boolean> {
  try {
    const dk = await scryptAsync(pin, stored.salt, KEYLEN);
    const want = Buffer.from(stored.hash, "hex");
    return dk.length === want.length && timingSafeEqual(dk, want);
  } catch {
    return false;
  }
}

/** A 6-digit numeric one-time code, generated with a CSPRNG. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * OTPs live only minutes and are single-use, so a fast salted SHA-256 is the
 * right tool — no need for scrypt's deliberate slowness here, and it keeps the
 * confirm path snappy. Constant-time compared on verify.
 */
export function hashOtp(otp: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${otp}`).digest("hex");
}

export function otpMatches(otp: string, salt: string, expected: string): boolean {
  const got = Buffer.from(hashOtp(otp, salt), "hex");
  const want = Buffer.from(expected, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export function randomSalt(): string {
  return randomBytes(16).toString("hex");
}
