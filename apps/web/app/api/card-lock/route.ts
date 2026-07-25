import { NextRequest, NextResponse } from "next/server";
import { getLock, putLock, removeLock, isProtected } from "@/lib/card-lock-store";
import { hashPin, verifyPin } from "@/lib/pin";
import { getCards, putCard } from "@/lib/card-index";
import { rateLimit, clientIp, tooMany, envLimit } from "@/lib/rate-limit";

/**
 * Manage the optional per-card PIN lock (owner operations).
 *
 *   GET  /api/card-lock?id=<cardId>   public — is this card PIN-protected?
 *   POST /api/card-lock               { action: "set" | "change" | "remove", … }
 *
 * The GET is public and leaks nothing but a boolean — the scan page needs it to
 * decide whether to show the PIN gate. The POST is, for the hackathon, gated on
 * a self-asserted owner email (the same trust level as /api/my-cards); a
 * production build should verify a Privy session token here instead.
 *
 * Setting a lock also strips the Tier-0 fragment from the card's saved URL and
 * stashes the data server-side, so the copied/written link no longer carries
 * the medical payload in the clear; removing the lock restores it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_PIN = 4;
const MAX_PIN = 64;

export async function GET(req: NextRequest) {
  const rl = await rateLimit("cardlock-get", clientIp(req), envLimit("CARDLOCK_GET", { limit: 60, windowSec: 60 }));
  if (!rl.ok) return tooMany(rl);

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });
  return NextResponse.json({ protected: await isProtected(id) });
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit("cardlock", clientIp(req), envLimit("CARDLOCK", { limit: 15, windowSec: 60 }));
  if (!rl.ok) return tooMany(rl);

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });

  const action = body.action;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!email.includes("@")) return NextResponse.json({ error: "owner email required" }, { status: 400 });

  if (action === "set") {
    if (await isProtected(id)) {
      return NextResponse.json({ error: "This card already has a PIN — use change." }, { status: 409 });
    }
    const pin = String(body.pin ?? "");
    const tier0 = typeof body.tier0 === "string" ? body.tier0 : "";
    const pinErr = validatePin(pin);
    if (pinErr) return NextResponse.json({ error: pinErr }, { status: 400 });
    if (!tier0.startsWith("0|")) {
      return NextResponse.json({ error: "card data (tier0) required to lock" }, { status: 400 });
    }

    const { hash, salt } = await hashPin(pin);
    const now = Date.now();
    await putLock({ cardId: id, hash, salt, email, tier0, createdAt: now, updatedAt: now });
    await stripFragmentFromIndex(email, id);
    return NextResponse.json({ ok: true, protected: true });
  }

  if (action === "change") {
    const lock = await getLock(id);
    if (!lock) return NextResponse.json({ error: "This card has no PIN set." }, { status: 404 });
    if (!(await verifyPin(String(body.currentPin ?? ""), lock))) {
      return NextResponse.json({ error: "Current PIN is incorrect." }, { status: 401 });
    }
    const pin = String(body.pin ?? "");
    const pinErr = validatePin(pin);
    if (pinErr) return NextResponse.json({ error: pinErr }, { status: 400 });

    const { hash, salt } = await hashPin(pin);
    await putLock({ ...lock, hash, salt, updatedAt: Date.now() });
    return NextResponse.json({ ok: true, protected: true });
  }

  if (action === "remove") {
    const lock = await getLock(id);
    if (!lock) return NextResponse.json({ ok: true, protected: false }); // already unlocked
    if (!(await verifyPin(String(body.currentPin ?? ""), lock))) {
      return NextResponse.json({ error: "Current PIN is incorrect." }, { status: 401 });
    }
    await restoreFragmentToIndex(email, id, lock.tier0);
    await removeLock(id);
    return NextResponse.json({ ok: true, protected: false });
  }

  return NextResponse.json({ error: "action must be set, change or remove" }, { status: 400 });
}

function validatePin(pin: string): string | null {
  if (pin.length < MIN_PIN) return `PIN must be at least ${MIN_PIN} characters.`;
  if (pin.length > MAX_PIN) return `PIN must be at most ${MAX_PIN} characters.`;
  return null;
}

/**
 * Drop the `#…` Tier-0 fragment from the card's saved URL in the email index, so
 * the link the owner copies or writes to a tag no longer carries the medical
 * payload once the card is locked. Best-effort — a failure here must not fail
 * the lock operation.
 */
async function stripFragmentFromIndex(email: string, id: string): Promise<void> {
  try {
    const card = (await getCards(email)).find((c) => c.id === id);
    if (!card?.url || !card.url.includes("#")) return;
    await putCard(email, { ...card, url: card.url.split("#")[0] });
  } catch {
    /* index is a convenience mirror; ignore */
  }
}

/** Restore the fragment URL from the stored Tier-0 when a lock is removed. */
async function restoreFragmentToIndex(email: string, id: string, tier0: string): Promise<void> {
  try {
    const card = (await getCards(email)).find((c) => c.id === id);
    if (!card?.url || card.url.includes("#")) return;
    await putCard(email, { ...card, url: `${card.url.split("#")[0]}#${tier0}` });
  } catch {
    /* ignore */
  }
}
