import{query,getPool}from"../lib/server/db";import{loadEnvConfig}from"@next/env";loadEnvConfig(process.cwd());
async function main(){const rows=await Promise.all([
 query(`SELECT count(*)::int count,COALESCE(sum(p.amount_token_units/8),0)::text amount FROM package_purchases p WHERE p.status='CONFIRMED' AND p.amount_token_units>=8000000`),
 query(`SELECT count(*)::int count,COALESCE(sum(gross_amount),0)::text amount FROM x4_income_history WHERE level_number=1`),
 query(`SELECT count(*)::int count,COALESCE(sum(credited_amount/10),0)::text amount FROM income_credit_ledger WHERE credited_amount>0`),
 query(`SELECT finding,count(*)::int count,COALESCE(sum(amount),0)::text amount FROM dividend_repair_audit GROUP BY finding`),
]);console.log(JSON.stringify({historicalPackageMagicCandidates:rows[0].rows[0],historicalX4MagicCandidates:rows[1].rows[0],historicalEarningSplitCandidates:rows[2].rows[0],dividendRepairFindings:rows[3].rows},null,2))}
main().finally(()=>getPool().end());
