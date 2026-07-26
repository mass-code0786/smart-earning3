import { query } from "./db";

export type X3RecoveryAuditRow = {
  pending_allocation_id:string; recovery_state:string; failure_count:number;
  failure_classification:string|null; source_reference:string|null;
  pending_exists:boolean; resolved:boolean; recycle_exists:boolean; cycle_exists:boolean; purchase_exists:boolean;
};

export async function auditX3Recovery() {
  const rows=(await query<X3RecoveryAuditRow>(`SELECT s.pending_allocation_id,s.recovery_state,s.failure_count,
    s.failure_classification,s.source_reference,(p.id IS NOT NULL) pending_exists,
    (pr.id IS NOT NULL) resolved,(r.id IS NOT NULL) recycle_exists,
    (c.id IS NOT NULL) cycle_exists,(pp.id IS NOT NULL) purchase_exists
    FROM x3_recovery_schedule s
    LEFT JOIN x3_pending_allocations p ON p.id=s.pending_allocation_id
    LEFT JOIN x3_pending_resolutions pr ON pr.pending_allocation_id=p.id
    LEFT JOIN x3_recycle_events r ON r.id=p.previous_recycle_event_id
    LEFT JOIN x3_cycles c ON c.id=r.new_cycle_id
    LEFT JOIN package_purchases pp ON pp.id=p.source_package_purchase_id
    ORDER BY s.updated_at DESC,s.pending_allocation_id`)).rows;
  const classified=rows.map(row=>({...row,classification:
    row.resolved?"COMPLETED":
    !row.pending_exists||!row.recycle_exists||!row.cycle_exists||!row.purchase_exists?"STALE":
    row.recovery_state==="RETRY_SCHEDULED"?"RETRYABLE":
    row.recovery_state==="MANUAL_REVIEW"||row.recovery_state==="INVALID"?"INCONSISTENT":"VALID"}));
  return{
    generatedAt:new Date().toISOString(),readOnly:true,
    counts:{
      valid:classified.filter(row=>row.classification==="VALID").length,
      completed:classified.filter(row=>row.classification==="COMPLETED").length,
      stale:classified.filter(row=>row.classification==="STALE").length,
      retryable:classified.filter(row=>row.classification==="RETRYABLE").length,
      inconsistent:classified.filter(row=>row.classification==="INCONSISTENT").length,
    },
    records:classified,
  };
}

export async function classifyStaleRecoveryMetadata() {
  return query(`UPDATE x3_recovery_schedule s SET recovery_state='STALE',
    failure_classification='SOURCE_MISSING',stale_at=COALESCE(stale_at,now()),
    sanitized_error='Required X3 recovery lineage is missing',
    source_reference=COALESCE(source_reference,p.idempotency_key),updated_at=now()
    FROM x3_pending_allocations p
    LEFT JOIN x3_recycle_events r ON r.id=p.previous_recycle_event_id
    LEFT JOIN x3_cycles c ON c.id=r.new_cycle_id
    LEFT JOIN package_purchases pp ON pp.id=p.source_package_purchase_id
    WHERE p.id=s.pending_allocation_id AND (r.id IS NULL OR c.id IS NULL OR pp.id IS NULL)
      AND s.recovery_state NOT IN('RECOVERED','STALE') RETURNING s.pending_allocation_id`);
}
