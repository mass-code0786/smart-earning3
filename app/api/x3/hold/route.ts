import{NextResponse}from"next/server";import{requireSession}from"@/lib/server/auth";import{apiError}from"@/lib/server/http";import{getX3Hold}from"@/lib/server/x3-query-service";
export async function GET(){try{const s=await requireSession();return NextResponse.json(await getX3Hold(s.wallet))}catch(e){return apiError(e)}}
