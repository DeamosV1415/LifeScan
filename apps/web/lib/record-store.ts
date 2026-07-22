import fs from "node:fs";
import path from "node:path";

/**
 * Server-side mirror of Tier-1 ciphertext.
 *
 * The server stores the encrypted record and nothing else — no key, no share.
 * It physically cannot read what it holds, which is the point: mirroring the
 * ciphertext for availability costs the patient no privacy, because opening it
 * still requires two Guardians to independently approve.
 *
 * File-backed so it is inspectable and survives a restart. On an ephemeral
 * serverless filesystem it falls back to the committed seed (see seed/), so the
 * demo patient is always retrievable even from a cold instance.
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

function readFile(file: string): Record<string, StoredRecord> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function load(): Record<string, StoredRecord> {
  // Seed first, then overlay any runtime writes.
  return { ...readFile(SEED_FILE), ...readFile(STORE_FILE) };
}

export function putRecord(record: Omit<StoredRecord, "updatedAt">): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const all = readFile(STORE_FILE);
  all[record.patientHash.toLowerCase()] = { ...record, updatedAt: Date.now() };
  fs.writeFileSync(STORE_FILE, JSON.stringify(all, null, 2));
}

export function getRecord(patientHash: string): StoredRecord | undefined {
  return load()[patientHash.toLowerCase()];
}
