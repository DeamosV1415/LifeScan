import fs from "node:fs";
import path from "node:path";
import { redis } from "./redis";

/**
 * Server-side mirror of Tier-1 ciphertext.
 *
 * The server stores the encrypted record and nothing else — no key, no share.
 * It physically cannot read what it holds, which is the point: mirroring the
 * ciphertext for availability costs the patient no privacy, because opening it
 * still requires two Guardians to independently approve.
 *
 * Two backends behind one interface:
 *   • Upstash Redis (a single "records" hash) when configured — the durable
 *     store used on Vercel/Render, where the filesystem is ephemeral.
 *   • A local JSON file otherwise — inspectable, zero-dependency, used for the
 *     on-stage demo and local dev.
 * The committed seed (seed/records.json) is always merged in for reads, so the
 * demo patient is retrievable even from a cold instance with an empty store.
 */

export interface StoredRecord {
  patientHash: string;
  ciphertext: string;
  /** Public metadata for the ER dashboard preview — deliberately non-clinical. */
  label?: string;
  updatedAt: number;
}

const DATA_DIR = process.env.RECORD_STORE_DIR ?? path.resolve(process.cwd(), ".data");
const STORE_FILE = path.join(DATA_DIR, "records.json");
const SEED_FILE = path.resolve(process.cwd(), "seed/records.json");
const REDIS_KEY = "records";

function readFile(file: string): Record<string, StoredRecord> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function seedRecord(patientHash: string): StoredRecord | undefined {
  return readFile(SEED_FILE)[patientHash.toLowerCase()];
}

export async function putRecord(record: Omit<StoredRecord, "updatedAt">): Promise<void> {
  const key = record.patientHash.toLowerCase();
  const value: StoredRecord = { ...record, patientHash: key, updatedAt: Date.now() };

  const r = redis();
  if (r) {
    await r.hset(REDIS_KEY, { [key]: value });
    return;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const all = readFile(STORE_FILE);
  all[key] = value;
  fs.writeFileSync(STORE_FILE, JSON.stringify(all, null, 2));
}

export async function getRecord(patientHash: string): Promise<StoredRecord | undefined> {
  const key = patientHash.toLowerCase();

  const r = redis();
  if (r) {
    const hit = await r.hget<StoredRecord>(REDIS_KEY, key);
    return hit ?? seedRecord(key);
  }

  // Seed first, then overlay any runtime writes.
  return { ...readFile(SEED_FILE), ...readFile(STORE_FILE) }[key];
}
