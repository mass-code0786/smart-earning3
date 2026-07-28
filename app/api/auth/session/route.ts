import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";

export async function GET() {
  try {
    const session = await requireSession();
    const registered = await query<{ registered: boolean; status: string | null }>(
      `SELECT EXISTS(
         SELECT 1 FROM users
         WHERE lower(wallet_address)=lower($1) AND status='ACTIVE'
       ) registered,
       (SELECT status FROM users WHERE lower(wallet_address)=lower($1) LIMIT 1) status`,
      [session.wallet],
    );
    return NextResponse.json({
      ...session,
      registered: Boolean(registered.rows[0]?.registered),
      registrationStatus: registered.rows[0]?.status ?? null,
    });
  } catch (error) {
    return apiError(error);
  }
}
