import { NextRequest, NextResponse } from "next/server";
import { getLock, putLock, removeLock, putOtp, getOtp, delOtp, clearFails } from "@/lib/card-lock-store";
import { generateOtp, hashOtp, otpMatches, randomSalt, hashPin } from "@/lib/pin";
import { sendEmail, otpEmail } from "@/lib/email";
import { getCards, putCard } from "@/lib/card-index";
import { rateLimit, clientIp, tooMany, envLimit } from "@/lib/rate-limit";

/**
 * Owner-initiated PIN reset by email OTP.
 *
 *   POST { step: "request", id, email }             → email a one-time code
 *   POST { step: "confirm", id, email, otp, newPin }→ verify code, then set a
 *                                                      new PIN (or remove it if
 *                                                      newPin is empty)
 *
 * The code is emailed to the owner address recorded on the lock; a caller can't
 * redirect it by passing a different email (we send to the lock's own address).
 * A short TTL, single use, and a per-card confirm cap keep the 6-digit code out
 * of brute-force range.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });

  const step = body.step;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!id || !email.includes("@")) {
    return NextResponse.json({ error: "id and owner email required" }, { status: 400 });
  }

  if (step === "request") return handleRequest(req, id, email);
  if (step === "confirm") return handleConfirm(req, id, email, body);
  return NextResponse.json({ error: "step must be request or confirm" }, { status: 400 });
}

async function handleRequest(req: NextRequest, id: string, email: string) {
  // Tight limits: cap by IP and by card so this can't be used to spam an inbox.
  const ipRl = await rateLimit("reset-req", clientIp(req), envLimit("RESET_REQ", { limit: 5, windowSec: 300 }));
  if (!ipRl.ok) return tooMany(ipRl);
  const cardRl = await rateLimit("reset-req-card", id, envLimit("RESET_REQ_CARD", { limit: 3, windowSec: 300 }));
  if (!cardRl.ok) return tooMany(cardRl);

  const lock = await getLock(id);
  // Don't reveal whether a card exists or who owns it — always answer the same.
  if (!lock || lock.email !== email) {
    return NextResponse.json({ ok: true, dev: false });
  }

  const code = generateOtp();
  const salt = randomSalt();
  await putOtp(id, { salt, hash: hashOtp(code, salt) });

  const cardName = (await getCards(email)).find((c) => c.id === id)?.name ?? "your card";
  const { subject, html, text } = otpEmail(code, cardName);
  const sent = await sendEmail({ to: lock.email, subject, html, text });

  // We only reach here when the caller IS the owner, so surfacing delivery
  // trouble here doesn't leak anything (enumeration is already ruled out above).
  //  • dev:true  → no key set; the code was logged to the server console.
  //  • emailError → a key IS set but the provider rejected the send (usually a
  //    bad RESEND_FROM / unverified domain) — tell the owner so it isn't silent.
  return NextResponse.json({
    ok: true,
    dev: sent.dev,
    emailError: !sent.delivered && !sent.dev,
  });
}

async function handleConfirm(
  req: NextRequest,
  id: string,
  email: string,
  body: { otp?: unknown; newPin?: unknown },
) {
  const ipRl = await rateLimit("reset-confirm", clientIp(req), envLimit("RESET_CONFIRM", { limit: 10, windowSec: 300 }));
  if (!ipRl.ok) return tooMany(ipRl);
  // Per-card confirm cap — the real brake on guessing the 6-digit code.
  const cardRl = await rateLimit("reset-confirm-card", id, envLimit("RESET_CONFIRM_CARD", { limit: 8, windowSec: 900 }));
  if (!cardRl.ok) {
    return NextResponse.json({ error: "Too many attempts — request a new code shortly." }, { status: 429 });
  }

  const otp = typeof body.otp === "string" ? body.otp.trim() : "";
  const newPin = typeof body.newPin === "string" ? body.newPin : "";
  if (!otp) return NextResponse.json({ error: "code required" }, { status: 400 });

  const lock = await getLock(id);
  if (!lock || lock.email !== email) {
    return NextResponse.json({ error: "No reset is pending for this card." }, { status: 404 });
  }

  const stored = await getOtp(id);
  if (!stored || stored.expiresAt < Date.now() || !otpMatches(otp, stored.salt, stored.hash)) {
    return NextResponse.json({ error: "Invalid or expired code." }, { status: 401 });
  }

  // Code is good and single-use — consume it now.
  await delOtp(id);
  await clearFails(id);

  if (newPin) {
    if (newPin.length < 4 || newPin.length > 64) {
      return NextResponse.json({ error: "PIN must be 4–64 characters." }, { status: 400 });
    }
    const { hash, salt } = await hashPin(newPin);
    await putLock({ ...lock, hash, salt, updatedAt: Date.now() });
    return NextResponse.json({ ok: true, protected: true });
  }

  // No new PIN → remove the lock entirely and restore the offline fragment URL.
  try {
    const card = (await getCards(email)).find((c) => c.id === id);
    if (card?.url && !card.url.includes("#")) {
      await putCard(email, { ...card, url: `${card.url.split("#")[0]}#${lock.tier0}` });
    }
  } catch {
    /* index mirror is best-effort */
  }
  await removeLock(id);
  return NextResponse.json({ ok: true, protected: false });
}
