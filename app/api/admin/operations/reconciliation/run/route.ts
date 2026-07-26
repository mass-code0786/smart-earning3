import{NextRequest,NextResponse}from"next/server";import{z}from"zod";import{requireAdmin}from"@/lib/server/auth";import{apiError,assertSameOrigin}from"@/lib/server/http";import{runDatabaseReconciliation}from"@/lib/server/operations-service";
const schema=z.object({reason:z.string().trim().min(3)});
export async function POST(r:NextRequest){try{assertSameOrigin(r);const s=await requireAdmin();schema.parse(await r.json());return NextResponse.json(await runDatabaseReconciliation(s.wallet))}catch(e){return apiError(e)}}
