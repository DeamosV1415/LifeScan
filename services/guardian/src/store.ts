import fs from "node:fs";
import path from "node:path";

/**
 * A Guardian's private share store.
 *
 * Each Guardian holds exactly one share per patient and never sees the others.
 * In production these are three separately-operated services with separate
 * storage; for the hackathon they are three processes with three separate
 * files, which preserves the property that matters — no process ever holds
 * enough material to reconstruct a key.
 *
 * File-backed rather than a database on purpose: a Guardian's entire state is
 * inspectable, so "we cannot decrypt your record" is a claim anyone can check.
 */

export interface ShareStore {
  put(patientHash: string, share: string): void;
  get(patientHash: string): string | undefined;
  has(patientHash: string): boolean;
  count(): number;
}

export function createShareStore(filePath: string): ShareStore {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  let shares: Record<string, string> = {};
  if (fs.existsSync(resolved)) {
    try {
      shares = JSON.parse(fs.readFileSync(resolved, "utf8"));
    } catch {
      // A corrupt store must not take the Guardian down — it starts empty and
      // says so, rather than crash-looping during a demo.
      console.warn(`[store] ${resolved} was unreadable; starting empty`);
    }
  }

  const flush = () => fs.writeFileSync(resolved, JSON.stringify(shares, null, 2));

  return {
    put(patientHash, share) {
      shares[patientHash.toLowerCase()] = share;
      flush();
    },
    get(patientHash) {
      return shares[patientHash.toLowerCase()];
    },
    has(patientHash) {
      return patientHash.toLowerCase() in shares;
    },
    count() {
      return Object.keys(shares).length;
    },
  };
}

/**
 * Single-use nonces for the liveness challenge.
 *
 * Held in memory deliberately: a nonce that survives a restart is a nonce that
 * can be replayed. They expire quickly and are consumed on first use.
 */
export function createNonceStore(ttlMs = 120_000) {
  const nonces = new Map<string, number>();

  const sweep = () => {
    const now = Date.now();
    for (const [nonce, expires] of nonces) {
      if (expires < now) nonces.delete(nonce);
    }
  };

  return {
    issue(): string {
      sweep();
      const nonce = crypto.randomUUID();
      nonces.set(nonce, Date.now() + ttlMs);
      return nonce;
    },

    /** Returns true at most once per nonce. */
    consume(nonce: string): boolean {
      sweep();
      if (!nonces.has(nonce)) return false;
      nonces.delete(nonce);
      return true;
    },

    size(): number {
      sweep();
      return nonces.size;
    },
  };
}

export type NonceStore = ReturnType<typeof createNonceStore>;
