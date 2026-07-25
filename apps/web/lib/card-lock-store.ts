import fs from "node:fs";
import path from "node:path";
import { redis } from "./redis";

/**
 * Storage for the optional per-card PIN lock.
 *
 * Three kinds of state, all keyed by card id:
 *   • the lock itself — PIN hash + salt, the owner email (for OTP reset), and
 *     the Tier-0 payload to hand back once the PIN is verified;
 *   • a short-lived reset OTP;
 *   • a failed-attempt counter that drives the lockout.
 *
 * Dual-mode like the rest of the stack: durable in Upstash Redis when
 * configured (the deployed path), a local JSON file + in-memory maps otherwise
 * (dev and the on-stage demo, single process — fine for ephemeral OTP/counters).
 *
 * The lock is opt-in and off by default: no lock row means the card is a normal
 * offline emergency card, exactly as before.
 */

export interface CardLock {
  cardId: string;
  hash: string;
  salt: string;
  /** Owner login email (lowercased) — the address a reset OTP is sent to. */
  email: string;
  /** Tier-0 fragment body ("0|1|name|blood|…"), returned only on a PIN match. */
  tier0: string;
  createdAt: number;
  updatedAt: number;
}

interface StoredOtp {
  hash: string;
  salt: string;
  expiresAt: number;
}

const DATA_DIR = process.env.RECORD_STORE_DIR ?? path.resolve(process.cwd(), ".data");
const LOCK_FILE = path.join(DATA_DIR, "card-locks.json");
const LOCK_KEY = "cardlocks";

const norm = (id: string) => id.trim().toLowerCase();

// --- lock rows ------------------------------------------------------------

function readLockFile(): Record<string, CardLock> {
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  } catch {
    return {};
  }
}

export async function getLock(cardId: string): Promise<CardLock | null> {
  const id = norm(cardId);
  const r = redis();
  if (r) return (await r.hget<CardLock>(LOCK_KEY, id)) ?? null;
  return readLockFile()[id] ?? null;
}

export async function isProtected(cardId: string): Promise<boolean> {
  return (await getLock(cardId)) !== null;
}

export async function putLock(lock: CardLock): Promise<void> {
  const id = norm(lock.cardId);
  const value: CardLock = { ...lock, cardId: id };
  const r = redis();
  if (r) {
    await r.hset(LOCK_KEY, { [id]: value });
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const all = readLockFile();
  all[id] = value;
  fs.writeFileSync(LOCK_FILE, JSON.stringify(all, null, 2));
}

export async function removeLock(cardId: string): Promise<void> {
  const id = norm(cardId);
  const r = redis();
  if (r) {
    await r.hdel(LOCK_KEY, id);
    await clearFails(id);
    await delOtp(id);
    return;
  }
  const all = readLockFile();
  delete all[id];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOCK_FILE, JSON.stringify(all, null, 2));
  memOtp.delete(id);
  memFail.delete(id);
}

// --- OTP (ephemeral) ------------------------------------------------------

const memOtp = new Map<string, StoredOtp>();
const OTP_TTL_SEC = 600; // 10 minutes

export async function putOtp(cardId: string, otp: Omit<StoredOtp, "expiresAt">): Promise<void> {
  const id = norm(cardId);
  const value: StoredOtp = { ...otp, expiresAt: Date.now() + OTP_TTL_SEC * 1000 };
  const r = redis();
  if (r) {
    await r.set(`cardotp:${id}`, value, { ex: OTP_TTL_SEC });
    return;
  }
  memOtp.set(id, value);
}

export async function getOtp(cardId: string): Promise<StoredOtp | null> {
  const id = norm(cardId);
  const r = redis();
  if (r) return (await r.get<StoredOtp>(`cardotp:${id}`)) ?? null;
  const hit = memOtp.get(id);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    memOtp.delete(id);
    return null;
  }
  return hit;
}

export async function delOtp(cardId: string): Promise<void> {
  const id = norm(cardId);
  const r = redis();
  if (r) {
    await r.del(`cardotp:${id}`);
    return;
  }
  memOtp.delete(id);
}

// --- failed-attempt lockout ----------------------------------------------

const memFail = new Map<string, { count: number; resetAt: number }>();
const FAIL_WINDOW_SEC = 900; // 15-minute lockout window

/** Increment the failed-attempt counter and return the new total. */
export async function bumpFail(cardId: string): Promise<number> {
  const id = norm(cardId);
  const r = redis();
  if (r) {
    const key = `cardfail:${id}`;
    const count = await r.incr(key);
    if (count === 1) await r.expire(key, FAIL_WINDOW_SEC);
    return count;
  }
  const now = Date.now();
  const cur = memFail.get(id);
  if (!cur || cur.resetAt <= now) {
    memFail.set(id, { count: 1, resetAt: now + FAIL_WINDOW_SEC * 1000 });
    return 1;
  }
  cur.count += 1;
  return cur.count;
}

export async function getFails(cardId: string): Promise<number> {
  const id = norm(cardId);
  const r = redis();
  if (r) return Number((await r.get<number>(`cardfail:${id}`)) ?? 0);
  const cur = memFail.get(id);
  return cur && cur.resetAt > Date.now() ? cur.count : 0;
}

export async function clearFails(cardId: string): Promise<void> {
  const id = norm(cardId);
  const r = redis();
  if (r) {
    await r.del(`cardfail:${id}`);
    return;
  }
  memFail.delete(id);
}
