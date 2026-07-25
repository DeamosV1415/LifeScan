import type http from "node:http";

/**
 * A tiny in-memory fixed-window rate limiter for the Guardian's HTTP surface.
 *
 * In-memory is the right fit here: each Guardian is a single long-lived process
 * (unlike the serverless web routes), so one process sees every request and no
 * shared store is needed. Health checks are never limited — uptime monitors
 * must always get a real 200.
 *
 * Keyed by client IP, read from x-forwarded-for (Render/UptimeRobot sit behind
 * a proxy) with a fallback to the socket address.
 */

const WINDOW_MS = Number(process.env.GUARDIAN_RL_WINDOW_MS) || 60_000;
const MAX = Number(process.env.GUARDIAN_RL_MAX) || 60;

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
