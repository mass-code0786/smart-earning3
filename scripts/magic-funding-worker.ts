import{loadAuthoritativeEnvironment}from"../lib/server/production-environment";
import{getPool}from"../lib/server/db";
import{runMagicFundingOutbox,withMagicFundingWorkerLock}from"../lib/server/magic-funding-service";
import{isModulePaused}from"../lib/server/module-control-service";
import{operationsInstance,recordHeartbeat}from"../lib/server/operations-service";
loadAuthoritativeEnvironment(process.cwd());
const name="magic-funding-worker",instance=operationsInstance(name);
const seconds=Math.max(30,Number(process.env.MAGIC_FUNDING_WORKER_INTERVAL_SECONDS||60));
let active:Promise<unknown>|null=null,stopping=false;
async function run(){
 if(await isModulePaused("MAGIC_FUNDING_WORKER"))return recordHeartbeat({workerName:name,instanceId:instance,status:"PAUSED",intervalSeconds:seconds});
 try{const result=await withMagicFundingWorkerLock(()=>runMagicFundingOutbox());
  const status=!result?"IDLE":result.status==="SIGNER_NOT_CONFIGURED"?"DISABLED":result.status==="COMPLETED"?"IDLE":"DEGRADED";
  await recordHeartbeat({workerName:name,instanceId:instance,status,intervalSeconds:seconds,processed:result?.processed||0,metadata:{lockOwned:Boolean(result)}});
  if(result)process.stdout.write(JSON.stringify({scope:"Magic Funding",status,processed:result.processed})+"\n");
 }catch(error){await recordHeartbeat({workerName:name,instanceId:instance,status:"FAILED",intervalSeconds:seconds,failed:1,error});throw error}
}
async function execute(){if(active||stopping)return;active=run();try{await active}finally{active=null}}
await recordHeartbeat({workerName:name,instanceId:instance,status:"STARTING",intervalSeconds:seconds});
await execute();const timer=setInterval(()=>void execute().catch(console.error),seconds*1000);
async function stop(){if(stopping)return;stopping=true;clearInterval(timer);await active?.catch(()=>undefined);await recordHeartbeat({workerName:name,instanceId:instance,status:"STOPPED",intervalSeconds:seconds});await getPool().end();process.exit(0)}
process.once("SIGINT",()=>void stop());process.once("SIGTERM",()=>void stop());
