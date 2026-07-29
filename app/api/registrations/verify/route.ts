import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { apiError, assertSameOrigin } from "@/lib/server/http";
import { verifyAndActivateRegistration } from "@/lib/server/registration-service";
import {
  logRegistrationFailure, safeRegistrationError,
} from "@/lib/server/registration-preflight";

const schema = z.object({
  txHash: z.string(),
  sponsor: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

export async function POST(request: NextRequest) {
  let registrant: string | undefined;
  let sponsor: string | undefined;
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    registrant = session.wallet;
    const body = schema.parse(await request.json());
    sponsor = body.sponsor;
    const { txHash } = body;
    return NextResponse.json(await verifyAndActivateRegistration(session.wallet, txHash));
  } catch (error) {
    const safe = safeRegistrationError(error, "REGISTRATION_VERIFICATION_FAILED");
    logRegistrationFailure({
      stage: "VERIFICATION", error: safe, registrant, sponsor,
      original: error,
      endpoint: "/api/registrations/verify",
    });
    return apiError(safe);
  }
}
