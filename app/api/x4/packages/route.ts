import{NextResponse}from"next/server";
import{requireSession}from"@/lib/server/auth";
import{apiError}from"@/lib/server/http";
import{getX4Packages}from"@/lib/server/x4-query-service";
export async function GET(){try{const session=await requireSession();return NextResponse.json(await getX4Packages(session.wallet))}catch(error){return apiError(error)}}
