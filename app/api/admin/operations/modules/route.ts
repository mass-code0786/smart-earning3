import{NextResponse}from"next/server";import{requireAdmin}from"@/lib/server/auth";import{apiError}from"@/lib/server/http";import{getAllModuleStates}from"@/lib/server/module-control-service";
export async function GET(){try{await requireAdmin();return NextResponse.json({modules:await getAllModuleStates()})}catch(e){return apiError(e)}}
