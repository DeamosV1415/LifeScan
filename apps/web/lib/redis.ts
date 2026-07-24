import { Redis } from "@upstash/redis";

/**
 * Shared Upstash Redis client for the web server routes.
 *
 * Returns null when the REST credentials aren't configured, which is the signal
 * every store uses to fall back to its local-file behaviour. So the app runs
 * with zero external dependencies for local development and the on-stage demo,
 * and transparently persists to Redis once UPSTASH_REDIS_REST_URL /
 * UPSTASH_REDIS_REST_TOKEN are set (Vercel, Render).
 *
 * These are non-NEXT_PUBLIC, so they are only ever read on the server — the
 * token never reaches the browser.
 */

let client: Redis | null | undefined;

export function redis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}
