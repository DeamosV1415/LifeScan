import type http from "node:http";

/**
 * A tiny in-memory fixed-window rate limiter for the agent's HTTP surface.
 *
 * The agent is a single long-lived process, so one in-memory counter sees every
 * request — no shared store needed. Health checks stay above this so uptime
 * monitors are never throttled. Keyed by client IP (x-forwarded-for behind the
 * Render proxy, socket address otherwise).
 */

const WINDOW_MS = Number(process.env.AGENT_RL_WINDOW_MS) || 60_000;
const MAX = Number(process.env.AGENT_RL_MAX) || 60;

const hits = new Map<string, { count: number; resetAt: number }>();

export function clientIp(req: http.IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}

/** Returns true when the caller is over the limit and should be refused. */
export function isRateLimited(req: http.IncomingMessage): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || entry.resetAt <= now) {
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > MAX;
}
