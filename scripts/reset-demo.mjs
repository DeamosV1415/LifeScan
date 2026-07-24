/**
 * Demo reset — clears all local, ephemeral demo state so the next seed starts
 * from a clean slate.
 *
 * Why this exists: the Guardians refuse to overwrite a share they already hold
 * (a deliberate safety property). So if they still hold shares from an earlier
 * seal of the same patient, re-seeding produces NEW ciphertext but leaves the
 * OLD key shares in place — and decryption then fails with a GCM auth error
 * ("The operation failed for an operation-specific reason"). This wipes the
 * stale state so the reseal is consistent.
 *
 * IMPORTANT: the Guardians cache their shares in memory, loaded at boot. Deleting
 * their files is not enough on its own — you MUST restart the Guardian cluster
 * afterwards so they reload from the now-empty files. The web ciphertext mirror
 * is read from disk on every request, so clearing it takes effect immediately.
 *
 * Usage:
 *   1. Stop the Guardians   (Ctrl+C, or stop the background task)
 *   2. pnpm reset
 *   3. Restart the Guardians: pnpm --filter @lifescan/guardian start:all
 *   4. Re-seed / break glass again
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Everything here is gitignored, local-only demo state (file backend).
const targets = [
  "services/guardian/data/guardian-1.json",
  "services/guardian/data/guardian-2.json",
  "services/guardian/data/guardian-3.json",
  "apps/web/.data/records.json",
];

let removed = 0;
for (const rel of targets) {
  const abs = path.join(root, rel);
  if (fs.existsSync(abs)) {
    fs.rmSync(abs);
    console.log(`  ✓ removed ${rel}`);
    removed++;
  } else {
    console.log(`  · already clean ${rel}`);
  }
}

/**
 * Redis backend: clear the same state (ciphertext mirror + each Guardian's
 * share hash) so a reseal is consistent. The email→cards index is deliberately
 * left intact — it's meant to persist across demos. Reads are live in Redis
 * mode, so no Guardian restart is needed after this.
 */
function readEnvLocal() {
  try {
    const txt = fs.readFileSync(path.join(root, ".env.local"), "utf8");
    const get = (k) => {
      const m = txt.match(new RegExp("^" + k + "=(.*)$", "m"));
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
    };
    return { url: get("UPSTASH_REDIS_REST_URL"), token: get("UPSTASH_REDIS_REST_TOKEN") };
  } catch {
    return {};
  }
}

const { url, token } = readEnvLocal();
if (url && token) {
  const keys = ["records", "shares:guardian-1", "shares:guardian-2", "shares:guardian-3"];
  for (const key of keys) {
    try {
      const res = await fetch(`${url}/del/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      console.log(`  ✓ redis del ${key} → ${body.result ?? (res.ok ? "ok" : res.status)}`);
    } catch (e) {
      console.log(`  · redis del ${key} failed: ${e.message}`);
    }
  }
  console.log(
    `\nCleared local files + Redis keys.\n` +
      "Redis reads are live, so no Guardian restart is needed — just re-seed / break glass.\n",
  );
} else {
  console.log(
    `\nCleared ${removed} file(s).\n` +
      "\n⚠  The Guardians cache shares in memory — RESTART them now so they reload empty:\n" +
      "     pnpm --filter @lifescan/guardian start:all\n" +
      "   Then re-seed / break glass. (The web mirror is already clear.)\n",
  );
}
