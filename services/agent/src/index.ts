import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { createAgentChain, type BreakGlassEvent } from "./chain.ts";
import { collectAndDecrypt } from "./collect.ts";
import { runTriage } from "./reason.ts";
import { trace } from "./trace.ts";

// Load repo-root .env.local.
for (const line of fs.readFileSync(path.resolve(import.meta.dirname, "../../../.env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const PORT = Number(process.env.AGENT_PORT || 4100);
const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.6-luna";
const EFFORT = (process.env.OPENAI_REASONING_EFFORT ?? "low") as "minimal" | "low" | "medium" | "high";
const GUARDIANS = (process.env.NEXT_PUBLIC_GUARDIAN_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const RECORD_API = process.env.RECORD_API_URL ?? "http://localhost:3000";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Run the agent setup script first.`);
  return v;
}

const chain = createAgentChain({
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
  accessLogAddress: required("NEXT_PUBLIC_ACCESS_LOG_ADDRESS") as `0x${string}`,
  agentLogAddress: required("NEXT_PUBLIC_AGENT_LOG_ADDRESS") as `0x${string}`,
  privateKey: required("AGENT_PRIVATE_KEY"),
});

const client = new OpenAI({ apiKey: required("OPENAI_API_KEY") });

// Paramedic free-text context, delivered off-chain by the provider app; the
// on-chain contextHash lets anyone verify it was not altered.
const contexts = new Map<string, string>();

// De-dupe: watchContractEvent can redeliver a log; never triage twice.
const handled = new Set<string>();

const REASON_TEXT: Record<number, string> = {
  1: "Unconscious patient, cause unknown.",
  2: "Road traffic accident, suspected trauma.",
  3: "Suspected cardiac event.",
  4: "Suspected overdose.",
  99: "Emergency, unspecified.",
};

async function handleBreakGlass(event: BreakGlassEvent) {
  const key = event.patientHash.toLowerCase();
  if (handled.has(key)) return;
  handled.add(key);

  trace.emitTrace({
    patientHash: event.patientHash,
    kind: "trigger",
    text: "BreakGlassGranted observed on-chain — triage started autonomously",
  });

  try {
    trace.emitTrace({ patientHash: event.patientHash, kind: "perceive", text: "Fetching encrypted record and collecting key shares…" });

    const res = await fetch(`${RECORD_API}/api/records?hash=${event.patientHash}`);
    if (!res.ok) throw new Error("no mirrored record for this patient");
    const { ciphertext } = await res.json();

    const record = await collectAndDecrypt({
      chain,
      guardianUrls: GUARDIANS,
      patientHash: event.patientHash,
      ciphertext,
      threshold: 2,
    });

    trace.emitTrace({ patientHash: event.patientHash, kind: "perceive", text: "Record decrypted from 2 guardian shares" });

    const paramedicContext =
      contexts.get(key) ?? REASON_TEXT[event.reasonCode] ?? REASON_TEXT[99];

    await runTriage({
      client,
      model: MODEL,
      effort: EFFORT,
      chain,
      patientHash: event.patientHash,
      record,
      paramedicContext,
    });
  } catch (error) {
    trace.emitTrace({
      patientHash: event.patientHash,
      kind: "error",
      text: error instanceof Error ? error.message : "triage failed",
    });
    // Allow a retry on a later event for the same patient.
    handled.delete(key);
  }
}

// --- HTTP surface: SSE trace + context intake + health ---

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify({ status: "ok", agent: chain.agentAddress, model: MODEL, effort: EFFORT }));
  }

  if (req.method === "GET" && url.pathname === "/trace") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...cors,
    });
    const patient = url.searchParams.get("patient") ?? undefined;

    // Flush a comment immediately so the browser's EventSource fires `onopen`
    // (Node buffers the headers until the first byte otherwise), then a
    // heartbeat to keep the stream alive through any proxy.
    res.write(": connected\n\n");
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

    for (const e of trace.backlog(patient)) res.write(`data: ${JSON.stringify(e)}\n\n`);

    const onTrace = (e: { patientHash: string }) => {
      if (!patient || e.patientHash.toLowerCase() === patient.toLowerCase()) {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
      }
    };
    trace.on("trace", onTrace);
    req.on("close", () => {
      clearInterval(heartbeat);
      trace.off("trace", onTrace);
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/context") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (body.patientHash && typeof body.context === "string") {
      contexts.set(String(body.patientHash).toLowerCase(), body.context);
    }
    res.writeHead(200, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify({ stored: true }));
  }

  res.writeHead(404, cors);
  res.end();
});

async function main() {
  const authorized = await chain.isAuthorized();
  console.log(`[agent] address ${chain.agentAddress}`);
  console.log(`[agent] model ${MODEL} · effort ${EFFORT}`);
  console.log(`[agent] on-chain authorized: ${authorized}`);
  if (!authorized) {
    console.warn("[agent] NOT authorized on-chain — guardians will refuse. Run setup-agent.");
  }

  chain.watchBreakGlass((event) => {
    handleBreakGlass(event).catch((e) => console.error("[agent]", e));
  });

  server.listen(PORT, () => {
    console.log(`[agent] listening on :${PORT} — watching BreakGlassGranted`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
