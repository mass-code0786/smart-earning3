import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { assertSameOrigin, apiError } from "@/lib/server/http";
import { prepareBoosterTopUp } from "@/lib/server/booster-service";

const schema=z.object({amountTokenUnits:z.string().regex(/^[1-9]\d*$/)});

export async function POST(request:NextRequest){
 try{
  assertSameOrigin(request);
  const session=await requireSession(),body=schema.parse(await request.json());
  return NextResponse.json(await prepareBoosterTopUp(session.wallet,BigInt(body.amountTokenUnits)));
 }catch(error){return apiError(error)}
}
