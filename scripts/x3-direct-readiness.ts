import{query,getPool}from"../lib/server/db";
async function main(){const result=await query(`SELECT
 (SELECT count(*)::int FROM x3_cycles) legacy_cycles,
 (SELECT count(*)::int FROM x3_cycle_slots) legacy_slots,
 (SELECT count(*)::int FROM x3_pending_allocations p LEFT JOIN x3_pending_resolutions r ON r.pending_allocation_id=p.id WHERE r.id IS NULL) legacy_unresolved,
 (SELECT count(*)::int FROM x3_direct_cycles) direct_cycles,
 (SELECT count(*)::int FROM x3_direct_cycle_slots) direct_slots,
 (SELECT jsonb_build_object('chainId',chain_id,'contract',contract_address,'block',boundary_block_number,'logIndex',boundary_log_index,'mode',mode,'activatedAt',activated_at) FROM x3_direct_deployment_rollouts ORDER BY activated_at DESC LIMIT 1) rollout,
 (SELECT count(*)::int FROM package_purchases p JOIN contract_events e ON e.tx_hash=p.tx_hash AND e.event_name='PackagePurchased' LEFT JOIN x3_direct_cycle_slots s ON s.buyer_package_purchase_id=p.id JOIN x3_direct_deployment_rollouts r ON r.chain_id=e.chain_id AND r.contract_address=e.contract_address WHERE (e.block_number,e.log_index)>(r.boundary_block_number,r.boundary_log_index) AND s.id IS NULL) post_boundary_unprocessed`);
 console.log(JSON.stringify(result.rows[0],null,2));}
main().finally(()=>getPool().end());
