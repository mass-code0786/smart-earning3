import{transaction,getPool}from"../lib/server/db";
import{smartEarningDeployment}from"../lib/blockchain/deployment-metadata";
import{ensureCurrentDirectX3Alignment}from"../lib/server/x3-direct-service";
async function main(){const deployment=smartEarningDeployment();const changed=await transaction(ensureCurrentDirectX3Alignment);console.log(JSON.stringify({mode:'CONTRACT_ALIGNED',boundaryBlock:deployment.blockNumber-1,boundaryLogIndex:-1,contract:deployment.address,changed}));}
main().finally(()=>getPool().end());
