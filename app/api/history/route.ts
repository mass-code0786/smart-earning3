import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { apiError } from "@/lib/server/http";
import { getHistory } from "@/lib/server/history-query-service";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const search = request.nextUrl.searchParams;
    return NextResponse.json(await getHistory(session.wallet, {
      category: search.get("category"), eventType: search.get("eventType"), status: search.get("status"),
      fromDate: search.get("fromDate") || search.get("from"), toDate: search.get("toDate") || search.get("to"),
      sourceWallet: search.get("sourceWallet"), txHash: search.get("txHash"),
      packageNumber: search.has("packageNumber") ? Number(search.get("packageNumber")) : null,
      cursor: search.get("cursor"),
      limit: search.has("limit") ? Number(search.get("limit")) : 20,
    }));
  } catch (error) {
    return apiError(error);
  }
}
