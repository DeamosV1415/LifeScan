import http from "node:http";
import type { ChainReader } from "./chain.ts";
import { verifyProviderSignature } from "./chain.ts";
import type { NonceStore, ShareStore } from "./store.ts";

/**
 * The Guardian HTTP surface. Four endpoints, no framework.
 *
 *   GET  /health      liveness + how many shares this Guardian holds
 *   GET  /challenge   issue a single-use nonce for the provider to sign
 *   POST /shares      accept a share at seal time (patient app)
 *   POST /release     release a share, if and only if the chain permits it
 *
 * /release is the whole product. Every check in it must pass:
 *
 *   1. the nonce is one we issued and has not been used
 *   2. the signature over that nonce recovers to the claimed provider
 *   3. the chain says that provider holds a recent, unexpired grant
 *   4. the chain says the record is not frozen and the provider not blocked
 *
 * Checks 3 and 4 are a single on-chain call (hasRecentGrant), read by this
 * process over its own RPC connection. Nothing we say can override it.
 */

export interface GuardianDeps {
  id: string;
  chain: ChainReader;
  shares: ShareStore;
  nonces: NonceStore;
}

interface Json {
  [key: string]: unknown;
}

function send(res: http.ServerResponse, status: number, body: Json) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    // The provider app is served from a different origin (Vercel).
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(payload);
}

async function readJson(req: http.IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64_000) throw new Error("payload too large");
    chunks.push(chunk as Buffer);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function createGuardianServer({ id, chain, shares, nonces }: GuardianDeps) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    try {
      if (req.method === "OPTIONS") return send(res, 204, {});

      // Liveness — answer GET *and* HEAD, on /health and / , so uptime monitors
      // (UptimeRobot pings with HEAD by default) get a real 200 either way.
      if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === "/health" || url.pathname === "/")) {
        if (req.method === "HEAD") {
          res.writeHead(200, { "access-control-allow-origin": "*" });
          return res.end();
        }
        return send(res, 200, {
          guardian: id,
          status: "ok",
          sharesHeld: await shares.count(),
          pendingChallenges: nonces.size(),
        });
      }

      if (req.method === "GET" && url.pathname === "/challenge") {
        return send(res, 200, { guardian: id, nonce: nonces.issue() });
      }

      if (req.method === "POST" && url.pathname === "/shares") {
        const body = await readJson(req);
        const patientHash = String(body.patientHash ?? "");
        const share = String(body.share ?? "");

        if (!HEX32.test(patientHash)) {
          return send(res, 400, { error: "patientHash must be a 32-byte hex string" });
        }
        if (!/^[0-9a-fA-F]+$/.test(share) || share.length < 2) {
          return send(res, 400, { error: "share must be a non-empty hex string" });
        }
        if (await shares.has(patientHash)) {
          // Overwriting would silently invalidate the other Guardians' shares.
          return send(res, 409, { error: "a share is already held for this patient" });
        }

        await shares.put(patientHash, share);
        return send(res, 201, { guardian: id, stored: true });
      }

      if (req.method === "POST" && url.pathname === "/release") {
        const body = await readJson(req);
        const patientHash = String(body.patientHash ?? "");
        const provider = String(body.provider ?? "");
        const nonce = String(body.nonce ?? "");
        const signature = String(body.signature ?? "");

        if (!HEX32.test(patientHash) || !ADDRESS.test(provider)) {
          return send(res, 400, { error: "malformed patientHash or provider" });
        }

        // 1. Single-use challenge.
        if (!nonces.consume(nonce)) {
          return send(res, 401, {
            guardian: id,
            released: false,
            reason: "unknown or already-used challenge",
          });
        }

        // 2. The caller controls the provider key right now.
        const signatureValid = await verifyProviderSignature({
          provider: provider as `0x${string}`,
          patientHash,
          nonce,
          signature: signature as `0x${string}`,
        });
        if (!signatureValid) {
          return send(res, 401, {
            guardian: id,
            released: false,
            reason: "signature does not match the claimed provider",
          });
        }

        // 3+4. The chain's own verdict. This Guardian reads it directly.
        const permitted = await chain.isReleasePermitted(
          patientHash as `0x${string}`,
          provider as `0x${string}`,
        );
        if (!permitted) {
          return send(res, 403, {
            guardian: id,
            released: false,
            reason:
              "no active on-chain grant — the record may be frozen, the provider " +
              "revoked or blocked, or the grant expired",
          });
        }

        const share = await shares.get(patientHash);
        if (!share) {
          return send(res, 404, {
            guardian: id,
            released: false,
            reason: "this guardian holds no share for that patient",
          });
        }

        return send(res, 200, { guardian: id, released: true, share });
      }

      if (req.method === "POST" && url.pathname === "/release-agent") {
        const body = await readJson(req);
        const patientHash = String(body.patientHash ?? "");
        const agent = String(body.agent ?? "");
        const nonce = String(body.nonce ?? "");
        const signature = String(body.signature ?? "");

        if (!HEX32.test(patientHash) || !ADDRESS.test(agent)) {
          return send(res, 400, { error: "malformed patientHash or agent" });
        }
        if (!nonces.consume(nonce)) {
          return send(res, 401, { guardian: id, released: false, reason: "unknown or used challenge" });
        }

        const signatureValid = await verifyProviderSignature({
          provider: agent as `0x${string}`,
          patientHash,
          nonce,
          signature: signature as `0x${string}`,
        });
        if (!signatureValid) {
          return send(res, 401, { guardian: id, released: false, reason: "signature does not match agent" });
        }

        // The agent path: authorised on-chain AND a real grant exists.
        const permitted = await chain.isAgentReleasePermitted(
          patientHash as `0x${string}`,
          agent as `0x${string}`,
        );
        if (!permitted) {
          return send(res, 403, {
            guardian: id,
            released: false,
            reason: "agent not authorised on-chain, or no active grant, or record frozen",
          });
        }

        const share = await shares.get(patientHash);
        if (!share) {
          return send(res, 404, { guardian: id, released: false, reason: "no share held for that patient" });
        }

        return send(res, 200, { guardian: id, released: true, share });
      }

      return send(res, 404, { error: "not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      // Never leak internals to a caller that may be probing.
      console.error(`[guardian ${id}]`, message);
      return send(res, 500, { error: "internal error" });
    }
  });
}
