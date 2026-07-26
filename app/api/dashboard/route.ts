import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { userDashboard } from "@/lib/server/dashboard-service";
import { apiError } from "@/lib/server/http";

export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json({ user: await userDashboard(session.wallet) });
  } catch (error) {
    return apiError(error);
  }
}
