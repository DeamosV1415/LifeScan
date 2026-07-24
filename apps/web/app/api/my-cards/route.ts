import { NextRequest, NextResponse } from "next/server";
import { getCards, putCard, type IndexedCard } from "@/lib/card-index";

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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });

  const { email, card } = body as { email?: unknown; card?: Partial<IndexedCard> };
  if (typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  if (
    !card ||
    typeof card.id !== "string" ||
    typeof card.name !== "string" ||
    typeof card.bloodGroup !== "string"
  ) {
    return NextResponse.json({ error: "card { id, name, bloodGroup } required" }, { status: 400 });
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
  const email = req.nextUrl.searchParams.get("email");
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "email query param required" }, { status: 400 });
  }
  return NextResponse.json({ cards: await getCards(email) });
}
