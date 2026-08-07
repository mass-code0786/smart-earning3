import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { apiError } from "@/lib/server/http";
import { getMagicLevelReport } from "@/lib/server/magic-level-structure-service";

export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json(await getMagicLevelReport(session.wallet), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) { return apiError(error); }
}
