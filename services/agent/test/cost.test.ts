import { test } from "node:test";
import assert from "node:assert/strict";
import { priceUsage, formatCost } from "../src/cost.ts";

test("prices a known model against published rates", () => {
  // gpt-5.6-luna: $1/1M input, $6/1M output.
  const c = priceUsage("gpt-5.6-luna", { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.equal(c.usd, 7);
  assert.equal(c.priced, true);
});

test("counts cached and reasoning tokens without double-charging", () => {
  const c = priceUsage("gpt-5.6-luna", {
    input_tokens: 2000,
    output_tokens: 500,
    input_tokens_details: { cached_tokens: 1800 },
    output_tokens_details: { reasoning_tokens: 200 },
  });
  // Cost is still on the full token counts; cached/reasoning are reported, not re-priced here.
  assert.equal(c.cachedTokens, 1800);
  assert.equal(c.reasoningTokens, 200);
  assert.ok(Math.abs(c.usd - (2000 * 1 + 500 * 6) / 1_000_000) < 1e-9);
});

test("flags an unknown model instead of inventing a price", () => {
  const c = priceUsage("gpt-9-imaginary", { input_tokens: 1000, output_tokens: 1000 });
  assert.equal(c.priced, false);
  assert.equal(c.usd, 0);
  assert.match(formatCost(c), /unpriced/);
});

test("tolerates missing usage", () => {
  const c = priceUsage("gpt-5.6-luna", undefined);
  assert.equal(c.inputTokens, 0);
  assert.equal(c.usd, 0);
});

test("formats a cost line with token detail", () => {
  const c = priceUsage("gpt-5.6-luna", {
    input_tokens: 672,
    output_tokens: 280,
    output_tokens_details: { reasoning_tokens: 65 },
  });
  const line = formatCost(c);
  assert.match(line, /\$0\.00/);
  assert.match(line, /672/);
  assert.match(line, /65 reasoning/);
});
