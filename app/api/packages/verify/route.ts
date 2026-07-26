import { NextRequest,NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { apiError,assertSameOrigin } from "@/lib/server/http";
import { verifyPackagePurchase } from "@/lib/server/package-service";
const schema=z.object({txHash:z.string()});
export async function POST(request:NextRequest){try{assertSameOrigin(request);const session=await requireSession();const{txHash}=schema.parse(await request.json());return NextResponse.json(await verifyPackagePurchase(session.wallet,txHash))}catch(error){return apiError(error)}}
