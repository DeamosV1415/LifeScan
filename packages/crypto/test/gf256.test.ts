import { test } from "node:test";
import assert from "node:assert/strict";
import { add, div, mul } from "../src/gf256.ts";

test("multiplication has 1 as its identity", () => {
  for (let a = 0; a < 256; a++) {
    assert.equal(mul(a, 1), a, `1 * ${a}`);
  }
});

test("zero annihilates", () => {
  for (let a = 0; a < 256; a++) {
    assert.equal(mul(a, 0), 0);
    assert.equal(mul(0, a), 0);
  }
});

test("multiplication is commutative across the whole field", () => {
  for (let a = 0; a < 256; a++) {
    for (let b = a; b < 256; b++) {
      assert.equal(mul(a, b), mul(b, a), `${a} * ${b}`);
    }
  }
});

test("division inverts multiplication for every non-zero divisor", () => {
  // If this fails, Lagrange interpolation silently returns wrong secrets
  // rather than throwing — so it is worth checking exhaustively.
  for (let a = 0; a < 256; a++) {
    for (let b = 1; b < 256; b++) {
      assert.equal(div(mul(a, b), b), a, `(${a} * ${b}) / ${b}`);
    }
  }
});

test("addition is its own inverse (XOR)", () => {
  for (let a = 0; a < 256; a++) {
    for (let b = 0; b < 256; b++) {
      assert.equal(add(add(a, b), b), a);
    }
  }
});

test("division by zero throws rather than returning a plausible value", () => {
  assert.throws(() => div(5, 0), /division by zero/);
});
