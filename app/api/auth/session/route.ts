import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { isConfiguredAdmin } from "@/lib/server/admin-policy";
import { getSmartEarningContract } from "@/lib/blockchain/provider";

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
    const active = Boolean(registered.rows[0]?.registered);
    let registrationState: "ACTIVE" | "UNREGISTERED" | "SYNCHRONIZATION_PENDING" | "UNKNOWN" = "ACTIVE";
    if (!active) {
      try {
        registrationState = await getSmartEarningContract().registered(session.wallet)
          ? "SYNCHRONIZATION_PENDING" : "UNREGISTERED";
      } catch {
        registrationState = "UNKNOWN";
      }
    }
    return NextResponse.json({
      ...session,
      registered: active,
      registrationStatus: registered.rows[0]?.status ?? null,
      registrationState,
      isAdmin: isConfiguredAdmin(session.wallet),
    });
  } catch (error) {
    return apiError(error);
  }
}
