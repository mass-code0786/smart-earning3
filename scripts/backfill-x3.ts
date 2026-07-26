import { getPool, transaction } from "../lib/server/db";
import { processX3PackagePurchase } from "../lib/server/x3-service";
import { X3_PACKAGE_PRICES } from "../lib/server/x3-math";

const apply=process.argv.includes("--apply");

async function main(){
  const purchases=await getPool().query<{
    id:string;user_id:string;package_id:number;amount_token_units:string;tx_hash:string;
    block_number:string;log_index:number|null;event_id:string|null;
  }>(`SELECT p.id,p.user_id,p.package_id,p.amount_token_units::text,p.tx_hash,
      p.block_number::text,e.log_index,e.id event_id
    FROM package_purchases p
    LEFT JOIN contract_events e ON e.tx_hash=p.tx_hash AND e.event_name='PackagePurchased'
    LEFT JOIN x3_package_memberships m ON m.activation_purchase_id=p.id
    WHERE p.status='CONFIRMED' AND m.id IS NULL
    ORDER BY p.block_number NULLS LAST,e.log_index NULLS LAST,p.tx_hash,p.id`);
  process.stdout.write(`X3 backfill mode: ${apply?"APPLY":"DRY RUN"}\n`);
  process.stdout.write(`Unprocessed confirmed purchases: ${purchases.rowCount}\n`);
  for(const purchase of purchases.rows){
    const expected=X3_PACKAGE_PRICES[purchase.package_id-1];
    const discrepancies:string[]=[];
    if(!expected||expected.price!==BigInt(purchase.amount_token_units))discrepancies.push("package amount mismatch");
    if(purchase.block_number===null)discrepancies.push("missing block number");
    if(purchase.log_index===null)discrepancies.push("missing PackagePurchased event/log index");
    const sponsor=await getPool().query("SELECT 1 FROM referral_relations WHERE user_id=$1",[purchase.user_id]);
    const root=await getPool().query("SELECT 1 FROM matrix_placements WHERE user_id=$1 AND parent_user_id IS NULL",[purchase.user_id]);
    if(!sponsor.rows[0]&&!root.rows[0])discrepancies.push("missing permanent sponsor");
    if(discrepancies.length){
      process.stdout.write(`DISCREPANCY ${purchase.id} ${purchase.tx_hash}: ${discrepancies.join(", ")}\n`);
      continue;
    }
    process.stdout.write(`${apply?"PROCESS":"WOULD PROCESS"} block=${purchase.block_number} log=${purchase.log_index} package=${purchase.package_id} purchase=${purchase.id}\n`);
    if(apply)await transaction(client=>processX3PackagePurchase(client,{
      purchaseId:purchase.id,userId:purchase.user_id,packageId:purchase.package_id,
      amount:BigInt(purchase.amount_token_units),txHash:purchase.tx_hash,
      blockNumber:Number(purchase.block_number),sourceEventId:purchase.event_id,
    }));
  }
  await getPool().end();
}
main().catch(error=>{console.error(error);process.exitCode=1});
