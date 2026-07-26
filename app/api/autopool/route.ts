import{NextResponse}from"next/server";import{requireSession}from"@/lib/server/auth";import{apiError}from"@/lib/server/http";import{getAutopoolDashboard}from"@/lib/server/autopool-query-service";
export async function GET(){try{const session=await requireSession();return NextResponse.json(await getAutopoolDashboard(session.wallet))}catch(error){return apiError(error)}}
