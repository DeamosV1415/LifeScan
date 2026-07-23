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

// Everything here is gitignored, local-only demo state.
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

console.log(
  `\nCleared ${removed} file(s).\n` +
    "\n⚠  The Guardians cache shares in memory — RESTART them now so they reload empty:\n" +
    "     pnpm --filter @lifescan/guardian start:all\n" +
    "   Then re-seed / break glass. (The web mirror is already clear.)\n",
);
