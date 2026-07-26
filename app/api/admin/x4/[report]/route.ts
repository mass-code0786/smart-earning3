import{NextRequest,NextResponse}from"next/server";
import{requireAdmin}from"@/lib/server/auth";
import{apiError}from"@/lib/server/http";
import{getAdminX4Report}from"@/lib/server/x4-query-service";
export async function GET(request:NextRequest,context:{params:Promise<{report:string}>}){
  try{await requireAdmin();const{report}=await context.params;return NextResponse.json(await getAdminX4Report(report,request.nextUrl.searchParams))}
  catch(error){return apiError(error)}
}
