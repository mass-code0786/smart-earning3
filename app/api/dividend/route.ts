import{NextResponse}from"next/server";import{requireSession}from"@/lib/server/auth";import{apiError}from"@/lib/server/http";import{getDividendDashboard}from"@/lib/server/dividend-query-service";
export async function GET(){try{const s=await requireSession();return NextResponse.json(await getDividendDashboard(s.wallet))}catch(e){return apiError(e)}}
