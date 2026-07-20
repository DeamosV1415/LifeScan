/**
 * Arithmetic in GF(2^8) — the finite field Shamir's scheme operates over.
 *
 * Every byte value is an element of the field. Addition is XOR. Multiplication
 * is carry-less multiplication reduced modulo the AES irreducible polynomial
 * x^8 + x^4 + x^3 + x + 1 (0x11b). Working byte-wise means a secret of any
 * length is just N independent instances of the same tiny problem.
 */

const POLY = 0x11b;
const GENERATOR = 3;

/** Multiply without lookup tables. Used only to build the tables. */
function mulSlow(a: number, b: number): number {
  let result = 0;
  let x = a;
  let y = b;

  while (y > 0) {
    if (y & 1) result ^= x;
    y >>= 1;
    x <<= 1;
    if (x & 0x100) x ^= POLY;
  }

  return result & 0xff;
}

// EXP is doubled in length so that EXP[i + j] never needs a modulo — the
// largest index we can produce is LOG[255] + LOG[255] = 508.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = mulSlow(x, GENERATOR);
  }
  for (let i = 255; i < 512; i++) {
    EXP[i] = EXP[i - 255];
  }
}

export function add(a: number, b: number): number {
  return a ^ b;
}

export function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

export function div(a: number, b: number): number {
  if (b === 0) throw new Error("gf256: division by zero");
  if (a === 0) return 0;
  return EXP[LOG[a] - LOG[b] + 255];
}
