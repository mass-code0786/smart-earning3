import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool, query, transaction } from "./db";
import { ApiError } from "./http";
import { resumeX3PendingAllocation } from "./x3-service";
import { normalizeWallet } from "./auth";
import { classifyRecoveryError, getRecoveryPolicy, nextRecoveryState, recoveryBackoffSeconds } from "./x3-recovery-policy";
import { upsertAlert } from "./operations-service";

export type RecoveryTrigger="STARTUP"|"WORKER"|"ADMIN";
export type RecoveryResult={
  pendingId:string;status:"RECOVERED"|"FAILED"|"SKIPPED"|"LOCKED";
  terminalResult?:string;durationMs:number;errorCode?:string;error?:string;
  errorClassification?:"RETRYABLE"|"NON_RETRYABLE";
};
export type RecoveryFilters={packageId?:number;wallet?:string;pendingId?:string;pendingIds?:string[];status?:string;limit?:number};
const instanceId=`node-${process.pid}-${randomUUID().slice(0,8)}`;
const log=(event:string,data:Record<string,unknown>)=>console.info(JSON.stringify({scope:"x3-recovery",event,...data}));

export async function listRecoverablePending(filters:RecoveryFilters={}){
  const wallet=filters.wallet?normalizeWallet(filters.wallet):null;
  const policy=getRecoveryPolicy(),limit=Math.max(1,Math.min(filters.limit||policy.batchSize,policy.batchSize));
  return transaction(async client=>(await client.query<{id:string}>(
    `SELECT p.id FROM x3_recovery_schedule s
     JOIN x3_pending_allocations p ON p.id=s.pending_allocation_id
     LEFT JOIN users u ON u.id=p.root_user_id
     LEFT JOIN x3_pending_resolutions r ON r.pending_allocation_id=p.id
     WHERE r.id IS NULL
       AND (s.recovery_state IN ('PENDING','RETRY_SCHEDULED')
         OR (s.recovery_state='PROCESSING' AND s.updated_at<now()-interval '5 minutes'))
       AND s.next_attempt_at<=now()
       AND ($1::smallint IS NULL OR p.package_id=$1)
       AND ($2::text IS NULL OR u.wallet_address=$2)
       AND ($3::uuid IS NULL OR p.id=$3)
       AND ($4::text IS NULL OR p.status=$4)
       AND ($5::uuid[] IS NULL OR p.id=ANY($5))
     ORDER BY s.next_attempt_at,p.created_at,p.id LIMIT $6
     FOR UPDATE OF s SKIP LOCKED`,
    [filters.packageId||null,wallet,filters.pendingId||null,filters.status||"RECYCLE_PENDING",
      filters.pendingIds?.length?filters.pendingIds:null,limit],
  )).rows.map(row=>row.id));
}

async function tryPendingLock(client:PoolClient,pendingId:string){
  return Boolean((await client.query<{locked:boolean}>(
    "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked",
    [`x3:recovery:pending:${pendingId}`],
  )).rows[0]?.locked);
}

export async function recoverPendingAllocation(pendingId:string,trigger:RecoveryTrigger):Promise<RecoveryResult>{
  const started=Date.now();
  const metadata=(await query<{package_id:number;root_user_id:string|null;recycle_depth:number;previous_recycle_event_id:string|null;idempotency_key:string;resolved:boolean;recycle_exists:boolean;cycle_exists:boolean;purchase_exists:boolean;recovery_state:string|null}>(
    `SELECT p.package_id,p.root_user_id,p.recycle_depth,p.previous_recycle_event_id,p.idempotency_key,
       EXISTS(SELECT 1 FROM x3_pending_resolutions pr WHERE pr.pending_allocation_id=p.id) resolved,
       (r.id IS NOT NULL) recycle_exists,(c.id IS NOT NULL) cycle_exists,(pp.id IS NOT NULL) purchase_exists,
       s.recovery_state
     FROM x3_pending_allocations p
     LEFT JOIN x3_recovery_schedule s ON s.pending_allocation_id=p.id
     LEFT JOIN x3_recycle_events r ON r.id=p.previous_recycle_event_id
     LEFT JOIN x3_cycles c ON c.id=r.new_cycle_id
     LEFT JOIN package_purchases pp ON pp.id=p.source_package_purchase_id
     WHERE p.id=$1`,[pendingId],
  )).rows[0];
  if(!metadata)return{pendingId,status:"SKIPPED",terminalResult:"INVALID_ID",durationMs:Date.now()-started,errorCode:"X3_PENDING_NOT_FOUND",errorClassification:"NON_RETRYABLE"};
  if(metadata.recovery_state==="STALE"||metadata.recovery_state==="INVALID")
    return{pendingId,status:"SKIPPED",terminalResult:metadata.recovery_state,durationMs:Date.now()-started,errorCode:"X3_PENDING_NOT_FOUND",errorClassification:"NON_RETRYABLE"};
  if(metadata.resolved){
    await query(`UPDATE x3_recovery_schedule SET recovery_state='RECOVERED',
      failure_classification='COMPLETED_NOOP',completed_at=COALESCE(completed_at,now()),
      sanitized_error=NULL,source_reference=COALESCE(source_reference,$2),updated_at=now()
      WHERE pending_allocation_id=$1 AND recovery_state<>'RECOVERED'`,[pendingId,metadata.idempotency_key]);
    const outcome:RecoveryResult={pendingId,status:"SKIPPED",terminalResult:"COMPLETED_NOOP",durationMs:Date.now()-started};
    await recordAttempt(pendingId,trigger,outcome);
    return outcome;
  }
  if(!metadata.previous_recycle_event_id||!metadata.recycle_exists||!metadata.cycle_exists||!metadata.purchase_exists){
    const reason=!metadata.previous_recycle_event_id?"RECYCLE_PENDING source recycle event is missing":
      !metadata.recycle_exists?"Referenced recycle event is missing":!metadata.cycle_exists?"Referenced recycle cycle is missing":"Referenced package purchase is missing";
    await query(`UPDATE x3_recovery_schedule SET recovery_state='STALE',
      failure_classification='SOURCE_MISSING',stale_at=COALESCE(stale_at,now()),
      sanitized_error=$2::varchar,source_reference=COALESCE(source_reference,$3),last_error_code='X3_PENDING_NOT_FOUND',
      last_error_message=$2::text,updated_at=now() WHERE pending_allocation_id=$1 AND recovery_state<>'RECOVERED'`,
    [pendingId,reason,metadata.idempotency_key]);
    await upsertAlert({type:"X3_RECOVERY_SOURCE_MISSING",severity:"HIGH",module:null,
      title:"X3 recovery source is missing",description:reason,source:pendingId});
    const outcome:RecoveryResult={pendingId,status:"SKIPPED",terminalResult:"STALE",durationMs:Date.now()-started,
      errorCode:"X3_PENDING_NOT_FOUND",error:reason,errorClassification:"NON_RETRYABLE"};
    await recordAttempt(pendingId,trigger,outcome);
    log("stale_record",{pendingId,trigger,reason});
    return outcome;
  }
  let outcome:RecoveryResult;
  try{
    const result=await transaction(async client=>{
      if(!(await tryPendingLock(client,pendingId)))return{status:"LOCKED" as const};
      const schedule=await client.query<{recovery_state:string}>(
        "SELECT recovery_state FROM x3_recovery_schedule WHERE pending_allocation_id=$1 FOR UPDATE",[pendingId],
      );
      if(!schedule.rows[0])throw new ApiError(409,"X3 recovery schedule is missing","X3_BROKEN_LINEAGE");
      if(schedule.rows[0].recovery_state==="RECOVERED")return{status:"SKIPPED" as const};
      if(trigger!=="ADMIN"&&["PAUSED","MANUAL_REVIEW"].includes(schedule.rows[0].recovery_state))return{status:"SKIPPED" as const};
      await client.query(
        `UPDATE x3_recovery_schedule SET recovery_state='PROCESSING',last_attempt_at=now(),updated_at=now()
         WHERE pending_allocation_id=$1`,[pendingId],
      );
      const resumed=await resumeX3PendingAllocation(client,pendingId);
      if(resumed.status==="RECOVERED"||resumed.status==="SKIPPED"){
        await client.query(
          `UPDATE x3_recovery_schedule SET recovery_state='RECOVERED',next_attempt_at=now(),
           last_error_code=NULL,last_error_message=NULL,updated_at=now() WHERE pending_allocation_id=$1`,
          [pendingId],
        );
      }else if(resumed.status==="ROOT_PENDING"){
        await client.query(
          `UPDATE x3_recovery_schedule SET recovery_state='PAUSED',manually_paused_at=COALESCE(manually_paused_at,now()),
           updated_at=now() WHERE pending_allocation_id=$1`,[pendingId],
        );
      }
      return resumed;
    });
    const status=result.status==="RECOVERED"?"RECOVERED":result.status==="SKIPPED"||result.status==="ROOT_PENDING"?"SKIPPED":"LOCKED";
    outcome={pendingId,status,terminalResult:"terminalStatus"in result?result.terminalStatus:result.status,durationMs:Date.now()-started};
  }catch(error){
    const classification=classifyRecoveryError(error);
    outcome={pendingId,status:"FAILED",durationMs:Date.now()-started,
      errorCode:error instanceof ApiError?error.code:"RECOVERY_ERROR",
      error:error instanceof Error?error.message.slice(0,500):"Unknown recovery error",
      errorClassification:classification};
    await scheduleFailure(pendingId,outcome).catch(scheduleError=>log("schedule_failure_failed",{
      pendingId,error:scheduleError instanceof Error?scheduleError.message:"unknown",
    }));
  }
  await recordAttempt(pendingId,trigger,outcome).catch(error=>log("attempt_log_failed",{pendingId,error:error instanceof Error?error.message:"unknown"}));
  log("attempt",{pendingId,package:metadata?.package_id||null,userId:metadata?.root_user_id||null,
    recycleDepth:metadata?.recycle_depth||0,previousStep:metadata?.previous_recycle_event_id||"RECYCLE_PENDING",
    trigger,worker:instanceId,
    resumedStep:"RECYCLE_PLACEMENT",terminalResult:outcome.terminalResult||null,
    durationMs:outcome.durationMs,status:outcome.status,errorCode:outcome.errorCode||null});
  return outcome;
}

async function recordAttempt(pendingId:string,trigger:RecoveryTrigger,result:RecoveryResult){
  await transaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`x3:recovery:audit:${pendingId}`]);
    await client.query(
      `INSERT INTO x3_recovery_attempts(
         pending_allocation_id,trigger_type,worker_instance,attempt_number,status,error_code,
         error_message,duration_ms,previous_step,resumed_step,terminal_result,error_classification
       ) SELECT $1,$2,$3,COALESCE(max(attempt_number),0)+1,$4,$5,$6,$7,
         'RECYCLE_PENDING','RECYCLE_PLACEMENT',$8,$9
       FROM x3_recovery_attempts WHERE pending_allocation_id=$1`,
      [pendingId,trigger,instanceId,result.status,result.errorCode||null,result.error||null,
        result.durationMs,result.terminalResult||null,result.errorClassification||null],
    );
  });
}

async function scheduleFailure(pendingId:string,result:RecoveryResult){
  const policy=getRecoveryPolicy();
  await transaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`x3:recovery:pending:${pendingId}`]);
    const current=await client.query<{failure_count:number}>(
      "SELECT failure_count FROM x3_recovery_schedule WHERE pending_allocation_id=$1 FOR UPDATE",[pendingId],
    );
    if(!current.rows[0])return;
    const failures=current.rows[0].failure_count+1;
    const classification=result.errorClassification||"RETRYABLE";
    const state=nextRecoveryState(failures,classification,policy);
    const backoff=recoveryBackoffSeconds(failures,policy);
    await client.query(
      `UPDATE x3_recovery_schedule SET failure_count=$2,recovery_state=$3,
       next_attempt_at=CASE WHEN $3='RETRY_SCHEDULED' THEN now()+($4||' seconds')::interval ELSE next_attempt_at END,
       last_attempt_at=now(),last_error_code=$5,last_error_message=$6,
       permanently_failed_at=CASE WHEN $3='MANUAL_REVIEW' THEN now() ELSE NULL END,
       failure_classification=CASE WHEN $3='MANUAL_REVIEW' THEN
         CASE WHEN $7='NON_RETRYABLE' THEN 'FINANCIAL_INCONSISTENCY' ELSE 'RETRY_EXHAUSTED' END
         ELSE 'TRANSIENT_DEPENDENCY' END,sanitized_error=$6,updated_at=now()
       WHERE pending_allocation_id=$1 AND recovery_state<>'RECOVERED'`,
      [pendingId,failures,state,backoff,result.errorCode||null,result.error||null,classification],
    );
    if(state==="MANUAL_REVIEW")await upsertAlert({type:classification==="NON_RETRYABLE"?"X3_RECOVERY_FINANCIAL_MISMATCH":"X3_RECOVERY_RETRY_EXHAUSTED",
      severity:"HIGH",module:null,title:"X3 recovery requires manual review",
      description:result.error||"Recovery retry limit reached",source:pendingId});
  });
}

export type RecoveryAdapter={
  list():Promise<string[]>;
  recover(id:string):Promise<RecoveryResult>;
};
export async function executeRecoveryBatch(adapter:RecoveryAdapter){
  const ids=await adapter.list(),results:RecoveryResult[]=[];
  for(const id of ids)results.push(await adapter.recover(id));
  return results;
}

export async function runX3RecoveryBatch(trigger:RecoveryTrigger,filters:RecoveryFilters={}){
  return executeRecoveryBatch({
    list:()=>listRecoverablePending(filters),
    recover:id=>recoverPendingAllocation(id,trigger),
  });
}

export async function updateRecoveryControl(
  pendingIds:string[],action:"PAUSE"|"RESUME"|"MOVE_TO_PENDING",
){
  if(!pendingIds.length)return[];
  return transaction(async client=>{
    const state=action==="PAUSE"?"PAUSED":"PENDING";
    const reset=action==="MOVE_TO_PENDING";
    const result=await client.query<{pending_allocation_id:string}>(
      `UPDATE x3_recovery_schedule SET recovery_state=$2,next_attempt_at=now(),
       failure_count=CASE WHEN $3 THEN 0 ELSE failure_count END,
       manually_paused_at=CASE WHEN $2='PAUSED' THEN now() ELSE NULL END,
       permanently_failed_at=CASE WHEN $3 THEN NULL ELSE permanently_failed_at END,
       last_error_code=CASE WHEN $3 THEN NULL ELSE last_error_code END,
       last_error_message=CASE WHEN $3 THEN NULL ELSE last_error_message END,
       updated_at=now()
       WHERE pending_allocation_id=ANY($1::uuid[]) AND recovery_state<>'RECOVERED'
       RETURNING pending_allocation_id`,
      [pendingIds,state,reset],
    );
    return result.rows.map(x=>x.pending_allocation_id);
  });
}

export async function withRecoveryWorkerLock<T>(operation:()=>Promise<T>){
  const client=await getPool().connect();
  const name="x3:recovery:global-worker";
  const acquired=Boolean((await client.query<{locked:boolean}>(
    "SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked",[name],
  )).rows[0]?.locked);
  if(!acquired){client.release();return null}
  try{return await operation()}
  finally{
    try{await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[name])}
    finally{client.release()}
  }
}
