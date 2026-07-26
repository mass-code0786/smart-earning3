import{NextRequest,NextResponse}from"next/server";import{requireSession}from"@/lib/server/auth";import{apiError}from"@/lib/server/http";import{getX3History}from"@/lib/server/x3-query-service";
export async function GET(r:NextRequest){try{const s=await requireSession();return NextResponse.json(await getX3History(s.wallet,r.nextUrl.searchParams))}catch(e){return apiError(e)}}
