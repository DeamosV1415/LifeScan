import { NextRequest, NextResponse } from "next/server";
import { redis } from "./redis";

/**
 * A small fixed-window rate limiter, dual-mode like the rest of the stack.
 *
 *   • Upstash Redis when configured — a shared counter that holds across every
 *     serverless invocation on Vercel (in-memory state does NOT survive between
 *     Lambda cold/warm instances, so a per-process Map would leak limits there).
 *   • An in-memory Map otherwise — fine for local dev and a single long-lived
 *     process, and it means the limiter never becomes a hard dependency.
 *
 * Fixed-window (INCR + EXPIRE) is deliberately chosen over a sliding log: one
 * round-trip on the hot path, and the small burst allowance at a window edge is
 * irrelevant for abuse control at demo scale.
 *
 * Limits are generous enough never to trip a rehearsed run and are all
 * env-tunable via RL_<BUCKET>_LIMIT / RL_<BUCKET>_WINDOW — see the callers.
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  limit: number;
  /** Seconds until the window resets — used for Retry-After when blocked. */
  retryAfter: number;
}

interface RateLimitOptions {
  limit: number;
  windowSec: number;
}

// --- in-memory fallback ---------------------------------------------------

const memory = new Map<string, { count: number; resetAt: number }>();

function memoryLimit(key: string, { limit, windowSec }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const entry = memory.get(key);

  if (!entry || entry.resetAt <= now) {
    // Opportunistic sweep so an idle process doesn't grow the map unbounded.
    if (memory.size > 5_000) {
      for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    }
    memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { ok: true, remaining: limit - 1, limit, retryAfter: windowSec };
  }

  entry.count += 1;
  const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  return { ok: entry.count <= limit, remaining: Math.max(0, limit - entry.count), limit, retryAfter };
}

// --- public API -----------------------------------------------------------

/**
 * Count one hit against `bucket:id`. Returns whether it is within the limit.
 * Never throws — a limiter that fails open on a Redis blip is safer for a live
 * demo than one that locks everyone out, and the endpoints have their own
 * bounds (the faucet's spend cap, the guardians' chain checks) behind it.
 */
export async function rateLimit(
  bucket: string,
  id: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const r = redis();
  if (!r) return memoryLimit(`${bucket}:${id}`, opts);

  const key = `rl:${bucket}:${id}`;
  try {
    const count = await r.incr(key);
    if (count === 1) {
      await r.expire(key, opts.windowSec);
      return { ok: true, remaining: opts.limit - 1, limit: opts.limit, retryAfter: opts.windowSec };
    }
    const ok = count <= opts.limit;
    // Only pay for the TTL read when we actually need an accurate Retry-After.
    const retryAfter = ok ? opts.windowSec : Math.max(1, await r.ttl(key));
    return { ok, remaining: Math.max(0, opts.limit - count), limit: opts.limit, retryAfter };
  } catch {
    // Fail open, but still apply the in-memory limiter as a floor.
    return memoryLimit(`${bucket}:${id}`, opts);
  }
}

/**
 * Best-effort client identifier for keying limits. Vercel sets x-forwarded-for;
 * we take the left-most (original client) hop. Spoofable in general, but on
 * Vercel the platform overwrites it, so it's a sound key there.
 */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Standard 429 with a Retry-After header. */
export function tooMany(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: "Too many requests — slow down and try again shortly." },
    { status: 429, headers: { "retry-after": String(result.retryAfter) } },
  );
}

/**
 * Read an env-tuned limit, e.g. envLimit("FAUCET", { limit: 3, windowSec: 60 })
 * reads RL_FAUCET_LIMIT / RL_FAUCET_WINDOW, falling back to the defaults.
 */
export function envLimit(name: string, fallback: RateLimitOptions): RateLimitOptions {
  const limit = Number(process.env[`RL_${name}_LIMIT`]);
  const windowSec = Number(process.env[`RL_${name}_WINDOW`]);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : fallback.limit,
    windowSec: Number.isFinite(windowSec) && windowSec > 0 ? windowSec : fallback.windowSec,
  };
}
