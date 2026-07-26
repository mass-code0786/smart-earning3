import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createNonce } from "@/lib/server/auth";
import { apiError, assertSameOrigin } from "@/lib/server/http";

const schema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
}).strict();

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const { wallet } = schema.parse(await request.json());
    return NextResponse.json(await createNonce(wallet));
  } catch (error) {
    return apiError(error);
  }
}
