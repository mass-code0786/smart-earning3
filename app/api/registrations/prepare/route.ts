import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { apiError, assertSameOrigin } from "@/lib/server/http";
import { ensureRegistrationPlacement } from "@/lib/server/placement-service";
import { ApiError } from "@/lib/server/http";

const schema = z.object({
  sponsor: z.string(),
  requestKey: z.string().min(16).max(128).regex(/^[a-zA-Z0-9:_-]+$/),
});

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    if (session.chainId !== 97) {
      throw new ApiError(403, "Session is not authenticated for BNB Testnet", "WRONG_NETWORK");
    }
    const { sponsor, requestKey } = schema.parse(await request.json());
    return NextResponse.json(await ensureRegistrationPlacement(session.wallet, sponsor, requestKey));
  } catch (error) {
    return apiError(error);
  }
}
