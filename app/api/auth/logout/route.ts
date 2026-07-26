import { NextRequest, NextResponse } from "next/server";
import { apiError, assertSameOrigin } from "@/lib/server/http";
import { clearSession } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await clearSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
