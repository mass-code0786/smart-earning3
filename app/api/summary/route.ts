import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { apiError } from "@/lib/server/http";
import { getUserSummary } from "@/lib/server/summary-service";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const page = Number(request.nextUrl.searchParams.get("page") || 1);
    return NextResponse.json(await getUserSummary(session.wallet, Number.isInteger(page) ? page : 1), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) { return apiError(error); }
}
