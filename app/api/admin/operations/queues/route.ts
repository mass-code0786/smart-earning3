import{NextResponse}from"next/server";import{requireAdmin}from"@/lib/server/auth";import{apiError}from"@/lib/server/http";import{operationsOverview}from"@/lib/server/operations-service";
export async function GET(){try{await requireAdmin();const o=await operationsOverview();return NextResponse.json({queues:o.queues})}catch(e){return apiError(e)}}
