import{randomUUID}from"node:crypto";import{NextRequest,NextResponse}from"next/server";import{z}from"zod";import{requireAdmin}from"@/lib/server/auth";import{ApiError,apiError,assertSameOrigin}from"@/lib/server/http";import{runX3RecoveryBatch,updateRecoveryControl}from"@/lib/server/x3-recovery-service";import{query}from"@/lib/server/db";
const schema=z.object({action:z.enum(["RETRY","PAUSE","RESUME","MOVE_TO_PENDING"]).default("RETRY"),package:z.number().int().min(1).max(8).optional(),user:z.string().optional(),pendingId:z.string().uuid().optional(),pendingIds:z.array(z.string().uuid()).max(100).optional(),status:z.enum(["RECYCLE_PENDING","ROOT_PENDING"]).optional(),limit:z.number().int().min(1).max(100).optional()}).default({action:"RETRY"});
export async function POST(request:NextRequest){try{
  assertSameOrigin(request);const admin=await requireAdmin();const body=schema.parse(await request.json().catch(()=>({})));
  const selected=[...new Set([...(body.pendingIds||[]),...(body.pendingId?[body.pendingId]:[])])];
  let results:unknown;
  if(body.action==="RETRY"){
    if(selected.length)await updateRecoveryControl(selected,"MOVE_TO_PENDING");
    results=await runX3RecoveryBatch("ADMIN",{packageId:body.package,wallet:body.user,pendingId:body.pendingId,pendingIds:selected.length?selected:undefined,status:body.status,limit:body.limit});
  }else{
    if(!selected.length)throw new ApiError(400,"pendingId or pendingIds is required for this action","PENDING_SELECTION_REQUIRED");
    results={updated:await updateRecoveryControl(selected,body.action==="PAUSE"?"PAUSE":body.action==="RESUME"?"RESUME":"MOVE_TO_PENDING")};
  }
  await query(`INSERT INTO admin_audit_logs(actor_user_id,action,target_type,target_id,request_id,details) SELECT id,$2,'X3_PENDING',$3,$4,$5 FROM users WHERE wallet_address=$1`,[admin.wallet,`X3_${body.action}`,selected.join(",")||"batch",randomUUID(),JSON.stringify({filters:{...body,user:body.user?"[wallet-filter]":undefined},results})]);
  return NextResponse.json({action:body.action,results});
}catch(e){return apiError(e)}}
