export type RecoveryPolicy={
  initialBackoffSeconds:number;maxBackoffSeconds:number;
  maxAutomaticAttempts:number;batchSize:number;
};
const integer=(value:string|undefined,fallback:number,min:number,max:number)=>{
  const parsed=Number(value);return Number.isInteger(parsed)?Math.max(min,Math.min(parsed,max)):fallback;
};
export function getRecoveryPolicy(env:NodeJS.ProcessEnv=process.env):RecoveryPolicy{
  const initial=integer(env.X3_RECOVERY_INITIAL_BACKOFF_SECONDS,30,5,3600);
  const maximum=integer(env.X3_RECOVERY_MAX_BACKOFF_SECONDS,3600,initial,86400);
  return{
    initialBackoffSeconds:initial,maxBackoffSeconds:maximum,
    maxAutomaticAttempts:integer(env.X3_RECOVERY_MAX_AUTOMATIC_ATTEMPTS,10,1,100),
    batchSize:integer(env.X3_RECOVERY_BATCH_SIZE,50,1,500),
  };
}
export function recoveryBackoffSeconds(failureCount:number,policy:RecoveryPolicy){
  const exponent=Math.max(0,Math.min(failureCount-1,30));
  return Math.min(policy.maxBackoffSeconds,policy.initialBackoffSeconds*2**exponent);
}
const integrityCodes=new Set([
  "X3_PENDING_NOT_FOUND","X3_BROKEN_LINEAGE","X3_ALLOCATION_INVARIANT",
  "X3_AMOUNT_MISMATCH","X3_SPONSOR_MISSING","X3_SELF_PLACEMENT",
  "X3_BFS_LIMIT","INVALID_PACKAGE","X3_PENDING_NOT_RECOVERABLE",
]);
export function classifyRecoveryError(error:unknown):"RETRYABLE"|"NON_RETRYABLE"{
  const value=error as{code?:string};
  if(value?.code&&integrityCodes.has(value.code))return"NON_RETRYABLE";
  if(value?.code&&(/^(23)/.test(value.code)))return"NON_RETRYABLE";
  return"RETRYABLE";
}
export function nextRecoveryState(failureCount:number,classification:"RETRYABLE"|"NON_RETRYABLE",policy:RecoveryPolicy){
  return classification==="NON_RETRYABLE"||failureCount>=policy.maxAutomaticAttempts
    ?"MANUAL_REVIEW" as const:"RETRY_SCHEDULED" as const;
}
export function isRecoveryDue(state:string,nextAttemptAt:Date,now=new Date()){
  return(state==="PENDING"||state==="RETRY_SCHEDULED")&&nextAttemptAt.getTime()<=now.getTime();
}
