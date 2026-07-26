import{NextResponse}from"next/server";import{requireAdmin}from"@/lib/server/auth";import{apiError}from"@/lib/server/http";import{query}from"@/lib/server/db";
export async function GET(){try{await requireAdmin();return NextResponse.json({alerts:(await query("SELECT * FROM operations_alerts ORDER BY last_detected_at DESC LIMIT 500")).rows})}catch(e){return apiError(e)}}
