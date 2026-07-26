import{NextRequest,NextResponse}from"next/server";import{z}from"zod";import{requireSession}from"@/lib/server/auth";import{apiError,assertSameOrigin}from"@/lib/server/http";import{verifyBoosterTopUp}from"@/lib/server/booster-service";
const schema=z.object({txHash:z.string(),amountTokenUnits:z.string().regex(/^[1-9]\d*$/)});
export async function POST(r:NextRequest){try{assertSameOrigin(r);const s=await requireSession(),b=schema.parse(await r.json());
 return NextResponse.json(await verifyBoosterTopUp(s.wallet,b.txHash,BigInt(b.amountTokenUnits)))}catch(e){return apiError(e)}}
