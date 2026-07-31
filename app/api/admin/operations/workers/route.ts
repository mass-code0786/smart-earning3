import{NextResponse}from"next/server";
import{requireAdmin}from"@/lib/server/auth";
import{apiError}from"@/lib/server/http";
import{query}from"@/lib/server/db";

export async function GET(){
 try{
  await requireAdmin();
  const lockNames=["booster:scheduler:worker","dividend:scheduler:worker","auto-withdraw:worker","magic-funding:worker","x3:recovery:global-worker"];
  const[workers,queues,locks]=await Promise.all([
   query(`SELECT *,extract(epoch from(now()-last_heartbeat_at))::bigint heartbeat_age_seconds,(now()-last_heartbeat_at)>make_interval(secs=>expected_interval_seconds*2) stale FROM worker_heartbeats ORDER BY worker_name,last_heartbeat_at DESC`),
   query(`SELECT (SELECT count(*)::int FROM magic_funding_outbox WHERE next_attempt_at<=now()) magic_funding_depth,(SELECT count(*)::int FROM auto_withdrawals WHERE status IN('RESERVED','BROADCASTING','BROADCASTED') OR(status='FAILED_RETRYABLE' AND next_attempt_at<=now())) withdrawal_depth,(SELECT count(*)::int FROM x3_recovery_schedule WHERE recovery_state IN('PENDING','RETRY_SCHEDULED') AND next_attempt_at<=now()) x3_recovery_depth,(SELECT count(*)::int FROM daily_dividend_settlements WHERE status='FAILED') dividend_failed,(SELECT COALESCE(sum(attempt_count),0)::int FROM magic_funding_outbox) magic_retry_count,(SELECT COALESCE(sum(attempt_count),0)::int FROM auto_withdrawals WHERE status='FAILED_RETRYABLE') withdrawal_retry_count`),
   query(`SELECT name,EXISTS(SELECT 1 FROM pg_locks l WHERE l.locktype='advisory' AND l.granted AND l.objid=((hashtext(name)::bigint&4294967295)::oid)) locked FROM unnest($1::text[]) name`,[lockNames]),
  ]);
  const active=workers.rows.filter((row:any)=>!["STOPPED","DISABLED"].includes(row.current_status)&&!row.stale);
  const duplicateOwners=Object.values(active.reduce((all:any,row:any)=>{(all[row.worker_name]||=[]).push(row.instance_id);return all},{})).filter((items:any)=>items.length>1);
  return NextResponse.json({
   workers:workers.rows,
   currentOwners:active.map((row:any)=>({workerName:row.worker_name,instanceId:row.instance_id,status:row.current_status,schedulerLagSeconds:Number(row.heartbeat_age_seconds),lastSuccessfulExecution:row.last_success_at})),
   duplicateOwners,advisoryLocks:locks.rows,queues:queues.rows[0],
  });
 }catch(error){return apiError(error)}
}
