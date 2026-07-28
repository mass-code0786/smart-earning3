import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { apiError } from "@/lib/server/http";
import { getTeam } from "@/lib/server/team-query-service";

export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json(await getTeam(session.wallet));
  } catch (error) {
    return apiError(error);
  }
}
