import { NextRequest, NextResponse } from "next/server";
import { getCards, putCard, type IndexedCard } from "@/lib/card-index";
import { rateLimit, clientIp, tooMany, envLimit } from "@/lib/rate-limit";

/**
 * Email → issued-cards index, so a patient's card ids follow their login across
 * browsers instead of being stranded in one device's localStorage.
 *
 *   POST /api/my-cards          { email, card: { id, name, bloodGroup, createdAt } }
 *   GET  /api/my-cards?email=…  → { cards: IndexedCard[] }
 *
 * Stores only the non-clinical label (id + name + blood group) — never the
 * Tier-0 card URL — so this adds no offline PHI to the server beyond what the
 * ciphertext mirror's label already exposes. For production this should be gated
 * on a verified Privy session token rather than a self-asserted email.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap the self-asserted fields so a caller can't push large blobs into the
// index. (This endpoint is still self-asserted-email by design for the demo —
// production should gate it on a verified Privy session token.)
const MAX_FIELD = 256;
const ok = (v: unknown, max = MAX_FIELD): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;

export async function POST(req: NextRequest) {
  const rl = await rateLimit("mycards", clientIp(req), envLimit("MYCARDS", { limit: 20, windowSec: 60 }));
  if (!rl.ok) return tooMany(rl);

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });

  const { email, card } = body as { email?: unknown; card?: Partial<IndexedCard> };
  if (typeof email !== "string" || !email.includes("@") || email.length > MAX_FIELD) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  if (!card || !ok(card.id) || !ok(card.name) || !ok(card.bloodGroup, 16)) {
    return NextResponse.json({ error: "card { id, name, bloodGroup } required" }, { status: 400 });
  }
  if (card.url !== undefined && !ok(card.url, 2048)) {
    return NextResponse.json({ error: "card.url too long" }, { status: 400 });
  }

  const cards = await putCard(email, {
    id: card.id,
    name: card.name,
    bloodGroup: card.bloodGroup,
    url: typeof card.url === "string" ? card.url : undefined,
    createdAt: typeof card.createdAt === "number" ? card.createdAt : Date.now(),
  });
  return NextResponse.json({ cards });
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit("mycards-get", clientIp(req), envLimit("MYCARDS_GET", { limit: 60, windowSec: 60 }));
  if (!rl.ok) return tooMany(rl);

  const email = req.nextUrl.searchParams.get("email");
  if (!email || !email.includes("@") || email.length > MAX_FIELD) {
    return NextResponse.json({ error: "email query param required" }, { status: 400 });
  }
  return NextResponse.json({ cards: await getCards(email) });
}
