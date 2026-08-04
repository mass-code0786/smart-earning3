import{loadAuthoritativeEnvironment}from"../lib/server/production-environment";
import{getPool}from"../lib/server/db";
import{runX3HoldExpiryScheduler,withX3HoldExpiryWorkerLock}from"../lib/server/x3-hold-expiry-service";
import{operationsInstance,recordHeartbeat}from"../lib/server/operations-service";

loadAuthoritativeEnvironment(process.cwd());
const name="x3-hold-expiry-worker",instance=operationsInstance(name);
const seconds=Math.max(30,Number(process.env.X3_HOLD_EXPIRY_WORKER_INTERVAL_SECONDS||60));
let active:Promise<unknown>|null=null,stopping=false;
async function run(){
  try{
    const result=await withX3HoldExpiryWorkerLock(()=>runX3HoldExpiryScheduler());
    await recordHeartbeat({workerName:name,instanceId:instance,status:"IDLE",intervalSeconds:seconds,
      processed:result?.flushed||0,metadata:{lockOwned:Boolean(result),batches:result?.batches||0}});
  }catch(error){await recordHeartbeat({workerName:name,instanceId:instance,status:"FAILED",intervalSeconds:seconds,failed:1,error});throw error;}
}
async function execute(){if(active||stopping)return;active=run();try{await active}finally{active=null;}}
async function main(){
  await recordHeartbeat({workerName:name,instanceId:instance,status:"STARTING",intervalSeconds:seconds});
  await execute();
  const timer=setInterval(()=>void execute().catch(console.error),seconds*1000);
  async function stop(){stopping=true;clearInterval(timer);await active?.catch(()=>undefined);await recordHeartbeat({workerName:name,instanceId:instance,status:"STOPPED",intervalSeconds:seconds});await getPool().end().catch(()=>undefined);process.exit(0);}
  process.once("SIGTERM",()=>void stop());process.once("SIGINT",()=>void stop());
}
main().catch(error=>{console.error(error);process.exit(1)});
