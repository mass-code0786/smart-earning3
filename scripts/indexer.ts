import { Interface } from "ethers";
import { PACKAGE_ABI, SMART_EARNING_ABI } from "../lib/blockchain/abi";
import { getProvider } from "../lib/blockchain/provider";
import { CHAIN_ID, getServerConfig } from "../lib/server/config";
import { query, transaction, getPool } from "../lib/server/db";
import { verifyAndActivateRegistration } from "../lib/server/registration-service";
import { verifyPackagePurchase } from "../lib/server/package-service";
import deployment from "../deployments/bsc-testnet.json";
import {
  indexHistoricalEvents,
  indexerBlockBatchSize,
  type IndexerCheckpointStore,
} from "./indexer-core";

function deploymentBlock() {
  const configured = process.env.SMART_EARNING_DEPLOYMENT_BLOCK;
  const value = configured === undefined || configured.trim() === ""
    ? deployment.blockNumber
    : Number(configured);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("SMART_EARNING_DEPLOYMENT_BLOCK must be a positive integer");
  }
  return value;
}

const checkpoints: IndexerCheckpointStore = {
  async getLastBlock(chainId, contractAddress) {
    const checkpoint=await query<{last_block:string}>(
      "SELECT last_block::text FROM indexer_checkpoints WHERE chain_id=$1 AND contract_address=$2",
      [chainId,contractAddress],
    );
    return checkpoint.rows[0] ? Number(checkpoint.rows[0].last_block) : undefined;
  },
  async commitLastBlock(chainId, contractAddress, blockNumber, blockHash) {
    await transaction(client=>client.query(
      `INSERT INTO indexer_checkpoints(chain_id,contract_address,last_block,last_block_hash)
       VALUES($1,$2,$3,$4) ON CONFLICT(chain_id,contract_address) DO UPDATE
       SET last_block=EXCLUDED.last_block,last_block_hash=EXCLUDED.last_block_hash,updated_at=now()`,
      [chainId,contractAddress,blockNumber,blockHash],
    ));
  },
};

async function indexContract() {
  const config=getServerConfig(),provider=getProvider();
  const iface=new Interface([...SMART_EARNING_ABI,...PACKAGE_ABI]);
  await indexHistoricalEvents({
    chainId:CHAIN_ID,
    contractAddress:config.SMART_EARNING_CONTRACT_ADDRESS,
    deploymentBlock:deploymentBlock(),
    confirmationsRequired:config.CONFIRMATIONS_REQUIRED,
    batchSize:indexerBlockBatchSize(),
    provider,
    checkpoints,
    async handleLog(log) {
      const event=iface.parseLog(log);
      if(event?.name==="UserRegistered"){
        await verifyAndActivateRegistration(String(event.args.user),log.transactionHash);
      } else if(event?.name==="PackagePurchased"){
        await verifyPackagePurchase(String(event.args.user),log.transactionHash);
      }
    },
  });
}

async function main(){
  await indexContract();
  await getPool().end();
}
main().catch(error=>{console.error(error);process.exitCode=1});
