import{NextResponse}from"next/server";import{requireAdmin}from"@/lib/server/auth";import{apiError}from"@/lib/server/http";import{query}from"@/lib/server/db";
export async function GET(){try{await requireAdmin();return NextResponse.json({runs:(await query("SELECT * FROM reconciliation_runs ORDER BY started_at DESC LIMIT 100")).rows})}catch(e){return apiError(e)}}
