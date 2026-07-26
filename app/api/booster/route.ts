import{NextResponse}from"next/server";import{requireSession}from"@/lib/server/auth";import{apiError}from"@/lib/server/http";import{getBoosterDashboard}from"@/lib/server/booster-query-service";
export async function GET(){try{const s=await requireSession();return NextResponse.json(await getBoosterDashboard(s.wallet))}catch(e){return apiError(e)}}
