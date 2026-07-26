import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";

export async function GET() {
  try {
    const session = await requireSession();
    const registered = await query<{ registered: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM users WHERE wallet_address=$1) registered",
      [session.wallet],
    );
    return NextResponse.json({
      ...session,
      registered: Boolean(registered.rows[0]?.registered),
    });
  } catch (error) {
    return apiError(error);
  }
}
