import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyNonceSignature } from "@/lib/server/auth";
import { apiError, assertSameOrigin } from "@/lib/server/http";

const schema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  nonce: z.string().length(48),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
}).strict();

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = schema.parse(await request.json());
    const wallet = await verifyNonceSignature(body);
    return NextResponse.json({ wallet, chainId: 97 });
  } catch (error) {
    return apiError(error);
  }
}
