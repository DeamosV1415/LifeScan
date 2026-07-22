/**
 * Real per-call cost accounting.
 *
 * We do not estimate token usage — we read the `usage` the API returns and
 * price it against the published rates. Every agent run prints what it actually
 * cost, so "it's just pennies" is a measured claim, not a hope.
 *
 * Prices are USD per 1M tokens, from developers.openai.com/api/docs/pricing
 * (checked 2026-07-22). Update here if the rate card moves.
 */

interface Rate {
  input: number;
  output: number;
}

const RATES: Record<string, Rate> = {
  "gpt-5.6-sol": { input: 5.0, output: 30.0 },
  "gpt-5.6-terra": { input: 2.5, output: 15.0 },
  "gpt-5.6-luna": { input: 1.0, output: 6.0 },
  "gpt-5.5": { input: 5.0, output: 30.0 },
  "gpt-5.4": { input: 2.5, output: 15.0 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
};

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

export interface CostBreakdown {
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  usd: number;
  priced: boolean;
}

export function priceUsage(model: string, usage: Usage | undefined): CostBreakdown {
  const rate = RATES[model];
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const cachedTokens = usage?.input_tokens_details?.cached_tokens ?? 0;
  const reasoningTokens = usage?.output_tokens_details?.reasoning_tokens ?? 0;

  const usd = rate
    ? (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000
    : 0;

  return {
    model,
    inputTokens,
    cachedTokens,
    outputTokens,
    reasoningTokens,
    usd,
    priced: Boolean(rate),
  };
}

export function formatCost(c: CostBreakdown): string {
  const dollars = c.priced ? `$${c.usd.toFixed(4)}` : "(unpriced model)";
  return (
    `${dollars} — in ${c.inputTokens}${c.cachedTokens ? ` (${c.cachedTokens} cached)` : ""}, ` +
    `out ${c.outputTokens}${c.reasoningTokens ? ` (${c.reasoningTokens} reasoning)` : ""}`
  );
}
