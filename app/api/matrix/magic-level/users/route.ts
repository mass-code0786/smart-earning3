import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getMagicLevelUsers } from "@/lib/server/magic-level-structure-service";
import { apiError } from "@/lib/server/http";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    return NextResponse.json(await getMagicLevelUsers(session.wallet, request.nextUrl.searchParams), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); return response;
  }
}
