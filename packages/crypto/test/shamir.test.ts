import { test } from "node:test";
import assert from "node:assert/strict";
import { combine, split } from "../src/shamir.ts";

const SECRET = new Uint8Array(32);
crypto.getRandomValues(SECRET);

test("any 2 of 3 shares reconstruct the secret", () => {
  const shares = split(SECRET, { shares: 3, threshold: 2 });
  const pairs = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];

  for (const [i, j] of pairs) {
    assert.deepEqual(
      combine([shares[i], shares[j]]),
      SECRET,
      `shares ${i}+${j} failed to reconstruct`,
    );
  }
});

test("all 3 shares also reconstruct (over-determined is still correct)", () => {
  const shares = split(SECRET, { shares: 3, threshold: 2 });
  assert.deepEqual(combine(shares), SECRET);
});

test("shares are distinct and none equals the secret", () => {
  const shares = split(SECRET, { shares: 3, threshold: 2 });

  for (const share of shares) {
    assert.notDeepEqual(share.subarray(1), SECRET);
  }
  assert.notDeepEqual(shares[0], shares[1]);
  assert.notDeepEqual(shares[1], shares[2]);
});

test("shares from different splits of the same secret do not interoperate", () => {
  // Each seal is independent. Mixing shares across seals must not silently
  // produce a plausible-looking key.
  const a = split(SECRET, { shares: 3, threshold: 2 });
  const b = split(SECRET, { shares: 3, threshold: 2 });

  const mixed = combine([a[0], b[1]]);
  assert.notDeepEqual(mixed, SECRET);
});

test("a 3-of-3 threshold is not satisfied by 2 shares", () => {
  const shares = split(SECRET, { shares: 3, threshold: 3 });
  assert.notDeepEqual(combine([shares[0], shares[1]]), SECRET);
  assert.deepEqual(combine(shares), SECRET);
});

test("round-trips secrets of many lengths", () => {
  for (const length of [1, 2, 15, 16, 31, 32, 64, 255, 1024]) {
    const secret = new Uint8Array(length);
    crypto.getRandomValues(secret);

    const shares = split(secret, { shares: 3, threshold: 2 });
    assert.deepEqual(combine([shares[0], shares[2]]), secret, `length ${length}`);
  }
});

test("round-trips an all-zero secret", () => {
  // A degenerate input that a naive implementation can special-case wrongly.
  const secret = new Uint8Array(32);
  const shares = split(secret, { shares: 3, threshold: 2 });
  assert.deepEqual(combine([shares[0], shares[1]]), secret);
});

test("rejects duplicate shares instead of returning garbage", () => {
  const shares = split(SECRET, { shares: 3, threshold: 2 });
  assert.throws(() => combine([shares[0], shares[0]]), /duplicate/);
});

test("rejects a single share", () => {
  const shares = split(SECRET, { shares: 3, threshold: 2 });
  assert.throws(() => combine([shares[0]]), /at least 2/);
});

test("rejects shares of differing lengths", () => {
  const shares = split(SECRET, { shares: 3, threshold: 2 });
  assert.throws(() => combine([shares[0], shares[1].subarray(0, 10)]), /length/);
});

test("rejects invalid split parameters", () => {
  assert.throws(() => split(SECRET, { shares: 2, threshold: 3 }), /shares must be/);
  assert.throws(() => split(SECRET, { shares: 3, threshold: 1 }), /threshold/);
  assert.throws(() => split(new Uint8Array(0), { shares: 3, threshold: 2 }), /empty/);
});
