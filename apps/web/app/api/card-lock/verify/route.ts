import { NextRequest, NextResponse } from "next/server";
import { getLock, bumpFail, getFails, clearFails } from "@/lib/card-lock-store";
import { verifyPin } from "@/lib/pin";
import { rateLimit, clientIp, tooMany, envLimit } from "@/lib/rate-limit";

/**
 * The scan-page gate. POST { id, pin } and, on a match, receive the Tier-0
 * payload to render. This is where a short PIN is made safe: a per-card
 * failed-attempt lockout (independent of the IP rate limit) means an attacker
 * gets a handful of tries, not the millions a 4-digit PIN would otherwise cede.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A few fat-finger tries are fine; beyond this the card locks for the window.
const MAX_ATTEMPTS = 5;

export async function POST(req: NextRequest) {
  // IP throttle so the lockout counter itself can't be hammered.
  const rl = await rateLimit("cardverify", clientIp(req), envLimit("CARDVERIFY", { limit: 10, windowSec: 60 }));
  if (!rl.ok) return tooMany(rl);

  const body = await req.json().catch(() => null);
  const id = body && typeof body.id === "string" ? body.id.trim() : "";
  const pin = body && typeof body.pin === "string" ? body.pin : "";
  if (!id || !pin) return NextResponse.json({ error: "id and pin required" }, { status: 400 });

  if ((await getFails(id)) >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { ok: false, locked: true, error: "Too many attempts — this card is locked for 15 minutes." },
      { status: 429 },
    );
  }

  const lock = await getLock(id);
  if (!lock) return NextResponse.json({ ok: false, error: "This card is not PIN-protected." }, { status: 404 });

  if (await verifyPin(pin, lock)) {
    await clearFails(id);
    return NextResponse.json({ ok: true, tier0: lock.tier0 });
  }

  const fails = await bumpFail(id);
  const remaining = Math.max(0, MAX_ATTEMPTS - fails);
  return NextResponse.json(
    {
      ok: false,
      remaining,
      locked: remaining === 0,
      error: remaining > 0 ? `Incorrect PIN — ${remaining} attempt${remaining === 1 ? "" : "s"} left.` : "Card locked for 15 minutes.",
    },
    { status: 401 },
  );
}
