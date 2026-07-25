import { NextRequest, NextResponse } from "next/server";
import { getRecord, putRecord } from "@/lib/record-store";
import { rateLimit, clientIp, tooMany, envLimit } from "@/lib/rate-limit";

/**
 * The ciphertext mirror. GET is public because ciphertext is not secret; the
 * security is in the key, which lives only as Guardian shares.
 *
 *   POST /api/records          store { patientHash, ciphertext, label }
 *   GET  /api/records?hash=0x… fetch the ciphertext for break-glass
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
// A sealed Tier-1 record is a few hundred bytes of hex; 64 KB is generous
// headroom while capping how much a single write can push into the store.
const MAX_CIPHERTEXT = 64_000;
const MAX_LABEL = 256;

export async function POST(req: NextRequest) {
  const rl = await rateLimit("records", clientIp(req), envLimit("RECORDS", { limit: 10, windowSec: 60 }));
  if (!rl.ok) return tooMany(rl);

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });

  const { patientHash, ciphertext, label } = body;

  if (typeof patientHash !== "string" || !HEX32.test(patientHash)) {
    return NextResponse.json({ error: "patientHash must be 32-byte hex" }, { status: 400 });
  }
  if (typeof ciphertext !== "string" || !/^[0-9a-fA-F]+$/.test(ciphertext)) {
    return NextResponse.json({ error: "ciphertext must be hex" }, { status: 400 });
  }
  if (ciphertext.length > MAX_CIPHERTEXT) {
    return NextResponse.json({ error: "ciphertext too large" }, { status: 413 });
  }
  if (typeof label === "string" && label.length > MAX_LABEL) {
    return NextResponse.json({ error: "label too long" }, { status: 413 });
  }

  await putRecord({ patientHash, ciphertext, label: typeof label === "string" ? label : undefined });
  return NextResponse.json({ stored: true });
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit("records-get", clientIp(req), envLimit("RECORDS_GET", { limit: 60, windowSec: 60 }));
  if (!rl.ok) return tooMany(rl);

  const hash = req.nextUrl.searchParams.get("hash");
  if (!hash || !HEX32.test(hash)) {
    return NextResponse.json({ error: "hash query param required" }, { status: 400 });
  }

  const record = await getRecord(hash);
  if (!record) {
    return NextResponse.json({ error: "no record mirrored for that patient" }, { status: 404 });
  }

  return NextResponse.json({ ciphertext: record.ciphertext, label: record.label });
}
