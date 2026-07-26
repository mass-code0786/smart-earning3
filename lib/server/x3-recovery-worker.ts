import { runX3RecoveryBatch, withRecoveryWorkerLock } from "./x3-recovery-service";
import { operationsInstance, recordHeartbeat } from "./operations-service";

const globalWorker=globalThis as typeof globalThis&{__x3RecoveryWorker?:{stop:()=>void}};
function intervalMs(){
  const seconds=Number(process.env.X3_RECOVERY_INTERVAL_SECONDS||30);
  return Math.max(5,Math.min(Number.isFinite(seconds)?seconds:30,3600))*1000;
}
function enabled(){return process.env.X3_RECOVERY_ENABLED!=="false"}

export function createX3RecoveryScheduler(run:(trigger:"STARTUP"|"WORKER")=>Promise<void>,milliseconds:number){
  let stopped=false,running=false;
  const execute=async(trigger:"STARTUP"|"WORKER")=>{
    if(stopped||running)return;
    running=true;try{await run(trigger)}finally{running=false}
  };
  const startup=setTimeout(()=>void execute("STARTUP"),0);startup.unref();
  const timer=setInterval(()=>void execute("WORKER"),milliseconds);timer.unref();
  return{stop(){if(stopped)return;stopped=true;clearTimeout(startup);clearInterval(timer)},execute};
}

export function startX3RecoveryWorker(runOverride?:(trigger:"STARTUP"|"WORKER")=>Promise<void>){
  if(!enabled()||globalWorker.__x3RecoveryWorker)return globalWorker.__x3RecoveryWorker;
  const workerInstance=operationsInstance("x3-recovery");
  void recordHeartbeat({workerName:"x3-recovery-worker",instanceId:workerInstance,status:"STARTING",intervalSeconds:Math.ceil(intervalMs()/1000)}).catch(()=>undefined);
  const scheduler=createX3RecoveryScheduler(async trigger=>{
    try{let result:Awaited<ReturnType<typeof runX3RecoveryBatch>>|null;
      if(runOverride){await runOverride(trigger);result=[]}else result=await withRecoveryWorkerLock(()=>runX3RecoveryBatch(trigger));
      const failed=result?.filter(item=>item.status==="FAILED").length||0;
      await recordHeartbeat({workerName:"x3-recovery-worker",instanceId:workerInstance,status:failed?"DEGRADED":"IDLE",
        intervalSeconds:Math.ceil(intervalMs()/1000),processed:result?.length||0,failed});
    }catch(error){await recordHeartbeat({workerName:"x3-recovery-worker",instanceId:workerInstance,status:"FAILED",
      intervalSeconds:Math.ceil(intervalMs()/1000),failed:1,error}).catch(()=>undefined);
      console.error(JSON.stringify({scope:"x3-recovery",event:"batch_failed",trigger,error:error instanceof Error?error.message:"unknown"}))}
  },intervalMs());
  const onTerm=()=>stop(),onInt=()=>stop();
  const stop=()=>{scheduler.stop();process.off("SIGTERM",onTerm);process.off("SIGINT",onInt)};
  globalWorker.__x3RecoveryWorker={stop};
  process.once("SIGTERM",onTerm);process.once("SIGINT",onInt);
  return globalWorker.__x3RecoveryWorker;
}
