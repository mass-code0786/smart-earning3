import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getMagicLevelStructure } from "@/lib/server/magic-level-structure-service";
import { apiError } from "@/lib/server/http";

export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json(await getMagicLevelStructure(session.wallet), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); return response;
  }
}
