import { NextRequest, NextResponse } from "next/server";
import { getRecord, putRecord } from "@/lib/record-store";

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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });

  const { patientHash, ciphertext, label } = body;

  if (typeof patientHash !== "string" || !HEX32.test(patientHash)) {
    return NextResponse.json({ error: "patientHash must be 32-byte hex" }, { status: 400 });
  }
  if (typeof ciphertext !== "string" || !/^[0-9a-fA-F]+$/.test(ciphertext)) {
    return NextResponse.json({ error: "ciphertext must be hex" }, { status: 400 });
  }

  await putRecord({ patientHash, ciphertext, label: typeof label === "string" ? label : undefined });
  return NextResponse.json({ stored: true });
}

export async function GET(req: NextRequest) {
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
