import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { apiError } from "@/lib/server/http";
import { getTeam } from "@/lib/server/team-query-service";

export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json(await getTeam(session.wallet), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
