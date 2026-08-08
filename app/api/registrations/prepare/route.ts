import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { apiError, assertSameOrigin } from "@/lib/server/http";
import { ensureRegistrationPlacement } from "@/lib/server/placement-service";
import { ApiError } from "@/lib/server/http";
import {
  logRegistrationFailure, registrationPreflight, RegistrationStageFailure,
  safeRegistrationError,
} from "@/lib/server/registration-preflight";
import { CHAIN_ID } from "@/lib/server/config";

const schema = z.object({
  sponsor: z.string(),
  requestKey: z.string().min(16).max(128).regex(/^[a-zA-Z0-9:_-]+$/),
});

export async function POST(request: NextRequest) {
  let registrant: string | undefined;
  let sponsor: string | undefined;
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    registrant = session.wallet;
    if (session.chainId !== CHAIN_ID) {
      throw new ApiError(422, "Session is authenticated for the wrong network", "WRONG_CHAIN");
    }
    const body = schema.parse(await request.json());
    sponsor = body.sponsor;
    const wallets = await registrationPreflight(session.wallet, body.sponsor);
    let placement;
    try {
      placement = await ensureRegistrationPlacement(wallets.registrant, wallets.sponsor, body.requestKey);
    } catch (error) {
      throw new RegistrationStageFailure("ENSURE_PLACEMENT", error);
    }
    return NextResponse.json(placement);
  } catch (error) {
    const safe = safeRegistrationError(error);
    logRegistrationFailure({
      stage: error instanceof RegistrationStageFailure ? error.stage : "PREPARE_RESPONSE",
      error: safe, original: error, registrant, sponsor,
      endpoint: "/api/registrations/prepare",
    });
    return apiError(safe);
  }
}
