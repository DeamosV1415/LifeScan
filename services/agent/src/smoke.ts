/**
 * Smoke test: confirm the key and model work, and print the REAL cost of one
 * representative triage call before we build the whole agent on top of it.
 *
 * The prompt is a scaled-down version of the actual triage task — the warfarin
 * + head-trauma interaction the demo hinges on — so the token count and cost
 * here are a realistic per-turn sample, not a toy "hello world".
 */

import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { formatCost, priceUsage } from "./cost.ts";

for (const line of fs.readFileSync(path.resolve(import.meta.dirname, "../../../.env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const model = process.env.OPENAI_MODEL ?? "gpt-5.6-luna";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = `You are an emergency triage assistant. A paramedic reports:
"male ~35, road traffic accident, GCS 9, BP 90/60, considering ceftriaxone".
The patient's record: blood group O+, on warfarin 5mg daily and metformin,
allergic to penicillin (anaphylaxis), has a cardiac pacemaker.
In two sentences, state the single most important contraindication to flag.`;

async function main() {
  console.log(`model: ${model}\ncalling…\n`);
  const started = Date.now();

  const res = await client.responses.create({
    model,
    input: prompt,
    reasoning: { effort: "low" },
  });

  const ms = Date.now() - started;
  console.log(res.output_text.trim());
  console.log(`\nlatency: ${(ms / 1000).toFixed(1)}s`);
  console.log(`cost:    ${formatCost(priceUsage(model, res.usage as never))}`);
}

main().catch((err) => {
  console.error("\nSmoke test failed:", err?.message ?? err);
  if (String(err?.message).match(/model|not found|does not exist/i)) {
    console.error(
      `\nThe model "${model}" may not be available on your account. ` +
        `Try setting OPENAI_MODEL=gpt-5.4-mini in .env.local.`,
    );
  }
  process.exit(1);
});
