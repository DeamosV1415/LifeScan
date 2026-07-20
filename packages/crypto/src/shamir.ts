/**
 * Shamir's Secret Sharing over GF(2^8).
 *
 * We split the AES data encryption key into 3 shares and require any 2 to
 * reconstruct it. Each Guardian node holds exactly one share and releases it
 * only after independently verifying on-chain that a break-glass grant exists.
 *
 * The security property that matters for the pitch: a single share reveals
 * *nothing* about the secret — not "less information", literally nothing. Any
 * one share is consistent with every possible secret of the same length. No
 * master key exists anywhere in this system, including on our own machines.
 *
 * Share wire format: [x, ...y] where x is the evaluation point (1..255) and y
 * holds one field element per secret byte. Length is secret length + 1.
 */

import { add, div, mul } from "./gf256.ts";

export interface SplitOptions {
  /** Total number of shares to produce. */
  shares: number;
  /** How many shares are required to reconstruct. */
  threshold: number;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/**
 * Evaluate the polynomial with the given coefficients at x, where
 * coefficients[0] is the constant term (the secret byte). Horner's method.
 */
function evaluate(coefficients: Uint8Array, x: number): number {
  let result = 0;
  for (let i = coefficients.length - 1; i >= 0; i--) {
    result = add(mul(result, x), coefficients[i]);
  }
  return result;
}

export function split(secret: Uint8Array, options: SplitOptions): Uint8Array[] {
  const { shares, threshold } = options;

  if (secret.length === 0) {
    throw new Error("shamir: cannot split an empty secret");
  }
  if (threshold < 2) {
    throw new Error("shamir: threshold must be at least 2");
  }
  if (shares < threshold) {
    throw new Error("shamir: shares must be >= threshold");
  }
  if (shares > 255) {
    throw new Error("shamir: at most 255 shares (GF(2^8) has 255 usable points)");
  }

  // Evaluation points must be distinct and non-zero — x=0 *is* the secret.
  const xs = Array.from({ length: shares }, (_, i) => i + 1);
  const out = xs.map((x) => {
    const share = new Uint8Array(secret.length + 1);
    share[0] = x;
    return share;
  });

  for (let byteIndex = 0; byteIndex < secret.length; byteIndex++) {
    // A fresh random polynomial per byte, pinned to pass through the secret
    // byte at x=0. Reusing coefficients across bytes would leak structure.
    const coefficients = new Uint8Array(threshold);
    coefficients.set(randomBytes(threshold - 1), 1);
    coefficients[0] = secret[byteIndex];

    // The leading coefficient must be non-zero or the polynomial silently
    // degrades to a lower degree, weakening the threshold.
    if (coefficients[threshold - 1] === 0) coefficients[threshold - 1] = 1;

    for (let i = 0; i < shares; i++) {
      out[i][byteIndex + 1] = evaluate(coefficients, xs[i]);
    }
  }

  return out;
}

export function combine(shares: Uint8Array[]): Uint8Array {
  if (shares.length < 2) {
    throw new Error("shamir: need at least 2 shares to combine");
  }

  const length = shares[0].length;
  if (length < 2) {
    throw new Error("shamir: malformed share");
  }
  if (shares.some((s) => s.length !== length)) {
    throw new Error("shamir: shares have differing lengths");
  }

  const xs = shares.map((s) => s[0]);
  if (xs.some((x) => x === 0)) {
    throw new Error("shamir: share has invalid evaluation point 0");
  }
  if (new Set(xs).size !== xs.length) {
    throw new Error("shamir: duplicate shares supplied");
  }

  const secret = new Uint8Array(length - 1);

  // Lagrange interpolation evaluated at x=0.
  for (let byteIndex = 0; byteIndex < secret.length; byteIndex++) {
    let acc = 0;

    for (let i = 0; i < shares.length; i++) {
      let basis = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        // (0 - x_j) / (x_i - x_j); subtraction is XOR in this field.
        basis = mul(basis, div(xs[j], add(xs[i], xs[j])));
      }
      acc = add(acc, mul(shares[i][byteIndex + 1], basis));
    }

    secret[byteIndex] = acc;
  }

  return secret;
}
