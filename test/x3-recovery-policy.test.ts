import{describe,expect,it,vi}from"vitest";
import{classifyRecoveryError,getRecoveryPolicy,isRecoveryDue,nextRecoveryState,recoveryBackoffSeconds}from"@/lib/server/x3-recovery-policy";
import{executeRecoveryBatch}from"@/lib/server/x3-recovery-service";
import{startX3RecoveryWorker}from"@/lib/server/x3-recovery-worker";

describe("X3 recovery retry and poison-record policy",()=>{
  const policy={initialBackoffSeconds:30,maxBackoffSeconds:3600,maxAutomaticAttempts:10,batchSize:50};
  it("schedules the first retry in the future",()=>{
    expect(recoveryBackoffSeconds(1,policy)).toBe(30);
    expect(new Date(Date.now()+recoveryBackoffSeconds(1,policy)*1000).getTime()).toBeGreaterThan(Date.now());
  });
  it("increases exponential backoff after repeated failures",()=>{
    expect([1,2,3,4].map(n=>recoveryBackoffSeconds(n,policy))).toEqual([30,60,120,240]);
  });
  it("never exceeds the configured maximum",()=>{
    expect(recoveryBackoffSeconds(99,policy)).toBe(3600);
  });
  it("does not select a record before next_attempt_at",()=>{
    expect(isRecoveryDue("RETRY_SCHEDULED",new Date(Date.now()+30_000))).toBe(false);
    expect(isRecoveryDue("RETRY_SCHEDULED",new Date(Date.now()-1))).toBe(true);
  });
  it("continues processing after a poisoned record fails",async()=>{
    const seen:string[]=[];
    const results=await executeRecoveryBatch({list:async()=>["bad","good"],recover:async id=>{
      seen.push(id);return{id,status:id==="bad"?"FAILED":"RECOVERED",pendingId:id,durationMs:0} as never;
    }});
    expect(seen).toEqual(["bad","good"]);expect(results[1].status).toBe("RECOVERED");
  });
  it("classifies broken lineage as non-retryable manual review",()=>{
    expect(classifyRecoveryError({code:"X3_BROKEN_LINEAGE"})).toBe("NON_RETRYABLE");
    expect(nextRecoveryState(1,"NON_RETRYABLE",policy)).toBe("MANUAL_REVIEW");
  });
  it("moves maximum automatic attempts to manual review",()=>{
    expect(nextRecoveryState(10,"RETRYABLE",policy)).toBe("MANUAL_REVIEW");
  });
  it("manual-review and paused records are never automatically due",()=>{
    const past=new Date(0);
    expect(isRecoveryDue("MANUAL_REVIEW",past)).toBe(false);
    expect(isRecoveryDue("PAUSED",past)).toBe(false);
  });
  it("resume makes a record eligible when its state returns to PENDING",()=>{
    expect(isRecoveryDue("PENDING",new Date(0))).toBe(true);
  });
  it("uses a fixed snapshot so a new continuation waits for another batch",async()=>{
    const source=["p1"],seen:string[]=[];
    await executeRecoveryBatch({list:async()=>[...source],recover:async id=>{
      seen.push(id);source.push("continuation");return{pendingId:id,status:"RECOVERED",durationMs:0};
    }});
    expect(seen).toEqual(["p1"]);
  });
  it("clamps configured batch size and unsafe retry values",()=>{
    expect(getRecoveryPolicy({...process.env,X3_RECOVERY_BATCH_SIZE:"9999",X3_RECOVERY_INITIAL_BACKOFF_SECONDS:"1",X3_RECOVERY_MAX_AUTOMATIC_ATTEMPTS:"0"}))
      .toEqual(expect.objectContaining({batchSize:500,initialBackoffSeconds:5,maxAutomaticAttempts:1}));
  });
  it("respects a selected batch size snapshot",async()=>{
    const source=Array.from({length:100},(_,i)=>`p${i}`),limit=50;
    const processed=await executeRecoveryBatch({list:async()=>source.slice(0,limit),recover:async id=>({pendingId:id,status:"RECOVERED",durationMs:0})});
    expect(processed).toHaveLength(50);
  });
  it("classifies database integrity constraints as manual review",()=>{
    expect(classifyRecoveryError({code:"23505"})).toBe("NON_RETRYABLE");
  });
  it("classifies transient serialization and connection errors as retryable",()=>{
    expect(classifyRecoveryError({code:"40001"})).toBe("RETRYABLE");
    expect(classifyRecoveryError({code:"08006"})).toBe("RETRYABLE");
  });
  it("process-global startup guard prevents duplicate intervals",async()=>{
    vi.useFakeTimers();const calls:string[]=[];
    const first=startX3RecoveryWorker(async trigger=>{calls.push(trigger)});
    const second=startX3RecoveryWorker(async trigger=>{calls.push(`duplicate-${trigger}`)});
    expect(second).toBe(first);await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["STARTUP"]);first?.stop();vi.useRealTimers();
  });
  it("already resolved records remain a financial no-op",async()=>{
    let financialWrites=0;
    const result=await executeRecoveryBatch({list:async()=>["resolved"],recover:async id=>({pendingId:id,status:"SKIPPED",terminalResult:"WITHDRAWABLE",durationMs:0})});
    expect(result[0].status).toBe("SKIPPED");expect(financialWrites).toBe(0);
  });
});
