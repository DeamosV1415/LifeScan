import fs from "node:fs";
import path from "node:path";
import { redis } from "./redis";

/**
 * Email → issued-cards index.
 *
 * A patient's Privy wallet is deterministic per email, but the card ids they
 * mint were previously kept only in that browser's localStorage — so logging in
 * from another browser lost them, and a `p-…` id can't be recovered from its
 * one-way patientHash. This index fixes that: it maps a login email to the
 * (non-clinical) list of cards it has issued, so the list follows the account
 * across devices and browsers.
 *
 * Deliberately non-clinical: it stores only id + name + blood group + timestamp
 * — the same public label the ciphertext mirror already keeps. The Tier-0 card
 * URL (which carries the offline payload) is NOT stored here; it stays on the
 * issuing device, so the server still never holds the offline PHI.
 *
 * Backed by Upstash Redis (a single "cards" hash keyed by email) when
 * configured, else a local JSON file — same dual-mode as the ciphertext mirror.
 */

export interface IndexedCard {
  id: string;
  name: string;
  bloodGroup: string;
  /**
   * The full Tier-0 card URL. Stored so the card is retrievable (copy / write to
   * a tag) from any browser the patient logs into — not just the issuing device.
   * Note: this URL's fragment carries the Tier-0 payload, so storing it here is a
   * deliberate convenience tradeoff. The offline scan path still never transmits
   * the fragment; only this opt-in card-management list holds it.
   */
  url?: string;
  createdAt: number;
}

const DATA_DIR = process.env.RECORD_STORE_DIR ?? path.resolve(process.cwd(), ".data");
const STORE_FILE = path.join(DATA_DIR, "cards.json");
const REDIS_KEY = "cards";

type Store = Record<string, IndexedCard[]>; // email (lowercased) → cards

function readFile(): Store {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function key(email: string): string {
  return email.trim().toLowerCase();
}

function withCard(list: IndexedCard[], card: IndexedCard): IndexedCard[] {
  return [card, ...list.filter((c) => c.id !== card.id)];
}

export async function getCards(email: string): Promise<IndexedCard[]> {
  const r = redis();
  if (r) {
    return (await r.hget<IndexedCard[]>(REDIS_KEY, key(email))) ?? [];
  }
  return readFile()[key(email)] ?? [];
}

export async function putCard(email: string, card: IndexedCard): Promise<IndexedCard[]> {
  const k = key(email);

  const r = redis();
  if (r) {
    const next = withCard((await r.hget<IndexedCard[]>(REDIS_KEY, k)) ?? [], card);
    await r.hset(REDIS_KEY, { [k]: next });
    return next;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const all = readFile();
  const next = withCard(all[k] ?? [], card);
  all[k] = next;
  fs.writeFileSync(STORE_FILE, JSON.stringify(all, null, 2));
  return next;
}
