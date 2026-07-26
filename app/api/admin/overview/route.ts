import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { adminOverview } from "@/lib/server/dashboard-service";
import { apiError } from "@/lib/server/http";
import { query } from "@/lib/server/db";
import { randomUUID } from "node:crypto";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdmin();
    const search = request.nextUrl.searchParams.get("q") || undefined;
    const result = await adminOverview(search);
    await query(
      `INSERT INTO admin_audit_logs(actor_user_id,action,target_type,target_id,request_id,details)
       SELECT id,'ADMIN_OVERVIEW_SEARCH','dashboard',$2,$3,$4 FROM users WHERE wallet_address=$1`,
      [session.wallet, search || null, request.headers.get("x-request-id") || randomUUID(), JSON.stringify({ hasSearch: Boolean(search) })],
    );
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
