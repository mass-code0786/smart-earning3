import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/server/config";
import { runDistributionCycle } from "@/lib/server/distribution-service";
import { apiError, ApiError } from "@/lib/server/http";

export async function POST(request: NextRequest) {
  try {
    const configured = getServerConfig().KEEPER_SECRET;
    const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!configured || !supplied) throw new ApiError(401, "Keeper authorization required", "KEEPER_AUTH");
    const a = Buffer.from(configured);
    const b = Buffer.from(supplied);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ApiError(401, "Keeper authorization required", "KEEPER_AUTH");
    }
    return NextResponse.json(await runDistributionCycle());
  } catch (error) {
    return apiError(error);
  }
}
