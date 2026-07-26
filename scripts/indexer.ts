import { Interface } from "ethers";
import { PACKAGE_ABI, SMART_EARNING_ABI } from "../lib/blockchain/abi";
import { getProvider } from "../lib/blockchain/provider";
import { CHAIN_ID, getServerConfig } from "../lib/server/config";
import { query, transaction, getPool } from "../lib/server/db";
import { verifyAndActivateRegistration } from "../lib/server/registration-service";
import { verifyPackagePurchase } from "../lib/server/package-service";

async function indexContract(
  address: string,
  abi: readonly string[],
  eventName: string,
  handle: (wallet:string,txHash:string)=>Promise<unknown>,
) {
  const config=getServerConfig(),provider=getProvider(),iface=new Interface(abi);
  const normalized=address.toLowerCase(),head=await provider.getBlockNumber();
  const safeHead=head-config.CONFIRMATIONS_REQUIRED+1;
  const checkpoint=await query<{last_block:string}>(
    "SELECT last_block::text FROM indexer_checkpoints WHERE chain_id=$1 AND contract_address=$2",
    [CHAIN_ID,normalized],
  );
  const from=checkpoint.rows[0]?Number(checkpoint.rows[0].last_block)+1:Math.max(0,safeHead-2_000);
  for(let start=from;start<=safeHead;start+=1_000){
    const end=Math.min(start+999,safeHead);
    const logs=await provider.getLogs({address:normalized,fromBlock:start,toBlock:end});
    for(const log of logs){
      const event=iface.parseLog(log);
      if(event?.name===eventName)await handle(String(event.args.user),log.transactionHash);
    }
    const block=await provider.getBlock(end);
    await transaction(client=>client.query(
      `INSERT INTO indexer_checkpoints(chain_id,contract_address,last_block,last_block_hash)
       VALUES($1,$2,$3,$4) ON CONFLICT(chain_id,contract_address) DO UPDATE
       SET last_block=EXCLUDED.last_block,last_block_hash=EXCLUDED.last_block_hash,updated_at=now()`,
      [CHAIN_ID,normalized,end,block?.hash||null],
    ));
  }
}

async function main(){
  const config=getServerConfig();
  await indexContract(
    config.SMART_EARNING_CONTRACT_ADDRESS,SMART_EARNING_ABI,"UserRegistered",
    (wallet,txHash)=>verifyAndActivateRegistration(wallet,txHash),
  );
  await indexContract(
    config.SMART_EARNING_CONTRACT_ADDRESS,PACKAGE_ABI,"PackagePurchased",
    (wallet,txHash)=>verifyPackagePurchase(wallet,txHash),
  );
  await getPool().end();
}
main().catch(error=>{console.error(error);process.exitCode=1});
