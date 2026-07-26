import{runBoosterScheduler,withBoosterWorkerLock}from"./booster-service";
export function createBoosterScheduler(run:()=>Promise<void>,milliseconds=60_000){
  let running=false,stopped=false;
  const execute=async()=>{if(running||stopped)return;running=true;try{await run()}finally{running=false}};
  const startup=setTimeout(()=>void execute(),0);startup.unref();
  const timer=setInterval(()=>void execute(),milliseconds);timer.unref();
  return{execute,stop(){stopped=true;clearTimeout(startup);clearInterval(timer)}};
}
export function startBoosterWorker(){
  return createBoosterScheduler(async()=>{await withBoosterWorkerLock(()=>runBoosterScheduler())},
    Math.max(30,Number(process.env.BOOSTER_WORKER_INTERVAL_SECONDS||60))*1000);
}
