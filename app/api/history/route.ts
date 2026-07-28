import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { apiError } from "@/lib/server/http";
import { getHistory } from "@/lib/server/history-query-service";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const search = request.nextUrl.searchParams;
    return NextResponse.json(await getHistory(session.wallet, {
      category: search.get("category"), status: search.get("status"), search: search.get("q"),
      from: search.get("from"), to: search.get("to"), cursor: search.get("cursor"),
      limit: search.has("limit") ? Number(search.get("limit")) : 20,
    }));
  } catch (error) {
    return apiError(error);
  }
}
