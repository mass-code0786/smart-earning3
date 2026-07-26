import{NextRequest,NextResponse}from"next/server";import{requireAdmin}from"@/lib/server/auth";import{apiError}from"@/lib/server/http";import{getAdminX3Report}from"@/lib/server/x3-query-service";
export async function GET(r:NextRequest){try{await requireAdmin();return NextResponse.json(await getAdminX3Report("summary",r.nextUrl.searchParams))}catch(e){return apiError(e)}}
