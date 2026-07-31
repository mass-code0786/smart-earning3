import{NextResponse}from"next/server";
export function GET(){return NextResponse.json({status:"ok",service:"smart-earning",commit:process.env.DEPLOYED_GIT_COMMIT||"unknown"},{headers:{"cache-control":"no-store"}})}
