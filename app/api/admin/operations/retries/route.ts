import{NextResponse}from"next/server";import{requireAdmin}from"@/lib/server/auth";import{apiError}from"@/lib/server/http";import{query}from"@/lib/server/db";
export async function GET(){try{await requireAdmin();return NextResponse.json({retries:(await query("SELECT * FROM operations_retry_requests ORDER BY created_at DESC LIMIT 200")).rows})}catch(e){return apiError(e)}}
