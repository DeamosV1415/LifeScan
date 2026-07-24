import fs from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";

/**
 * A Guardian's private share store.
 *
 * Each Guardian holds exactly one share per patient and never sees the others.
 * In production these are three separately-operated services with separate
 * storage; for the hackathon they are three processes with three separate
 * stores, which preserves the property that matters — no process ever holds
 * enough material to reconstruct a key.
 *
 * Two backends behind one interface:
 *   • Upstash Redis when configured — each Guardian gets its OWN hash key
 *     (`shares:<namespace>`, namespaced from its file name, e.g. guardian-1),
 *     so the "one store per Guardian, no shared material" property holds in the
 *     cloud where the filesystem is ephemeral. Reads/writes hit Redis live, so
 *     clearing it (pnpm reset) takes effect without restarting the Guardians.
 *   • A local JSON file otherwise — inspectable, so "we cannot decrypt your
 *     record" is a claim anyone can check. Loaded into memory at boot.
 */

export interface ShareStore {
  put(patientHash: string, share: string): Promise<void>;
  get(patientHash: string): Promise<string | undefined>;
  has(patientHash: string): Promise<boolean>;
  count(): Promise<number>;
}

function redisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

export function createShareStore(filePath: string): ShareStore {
  const resolved = path.resolve(filePath);
  const redis = redisClient();

  if (redis) {
    // Namespace by the store's file name (guardian-1 / -2 / -3), so each
    // Guardian's shares live under a distinct key even in a shared Redis DB.
    const key = `shares:${path.basename(resolved, path.extname(resolved))}`;
    const norm = (h: string) => h.toLowerCase();
    return {
      async put(patientHash, share) {
        await redis.hset(key, { [norm(patientHash)]: share });
      },
      async get(patientHash) {
        return (await redis.hget<string>(key, norm(patientHash))) ?? undefined;
      },
      async has(patientHash) {
        return (await redis.hexists(key, norm(patientHash))) === 1;
      },
      async count() {
        return await redis.hlen(key);
      },
    };
  }

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
    async put(patientHash, share) {
      shares[patientHash.toLowerCase()] = share;
      flush();
    },
    async get(patientHash) {
      return shares[patientHash.toLowerCase()];
    },
    async has(patientHash) {
      return patientHash.toLowerCase() in shares;
    },
    async count() {
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
