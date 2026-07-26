import{describe,expect,it}from"vitest";
import{executeRecoveryBatch,RecoveryAdapter,RecoveryResult}from"@/lib/server/x3-recovery-service";
import{createX3RecoveryScheduler}from"@/lib/server/x3-recovery-worker";
import{vi}from"vitest";

type RecordState={finalized:boolean;locked:boolean;placements:number;holds:number;capCredits:number;attempts:number;root?:boolean;failAt?:string};
function sharedRecovery(records:Map<string,RecordState>,ids:string[]):RecoveryAdapter{
  return{
    list:async()=>ids,
    recover:async id=>{
      const started=Date.now(),record=records.get(id)!;record.attempts++;
      if(record.locked)return{pendingId:id,status:"LOCKED",durationMs:Date.now()-started};
      if(record.finalized||record.root)return{pendingId:id,status:"SKIPPED",terminalResult:record.root?"ROOT_PENDING":"WITHDRAWABLE",durationMs:0};
      record.locked=true;
      try{
        if(record.placements===0)record.placements++;
        if(record.failAt==="placement"){record.failAt=undefined;throw new Error("crash after placement")}
        if(record.holds===0&&record.failAt==="hold"){record.holds++;record.failAt=undefined;throw new Error("crash after hold")}
        if(record.capCredits===0)record.capCredits++;
        if(record.failAt==="cap"){record.failAt=undefined;throw new Error("crash after cap")}
        record.finalized=true;
        return{pendingId:id,status:"RECOVERED",terminalResult:record.holds?"HELD":"WITHDRAWABLE",durationMs:Date.now()-started};
      }catch(error){
        return{pendingId:id,status:"FAILED",error:error instanceof Error?error.message:"error",durationMs:Date.now()-started};
      }finally{record.locked=false}
    },
  };
}

describe("X3 recovery coordinator",()=>{
  it("runs startup recovery, interval recovery, and stops safely",async()=>{
    vi.useFakeTimers();const triggers:string[]=[];
    const scheduler=createX3RecoveryScheduler(async trigger=>{triggers.push(trigger)},30_000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(triggers).toEqual(["STARTUP","WORKER"]);
    scheduler.stop();await vi.advanceTimersByTimeAsync(60_000);
    expect(triggers).toHaveLength(2);vi.useRealTimers();
  });
  it("performs startup recovery from the saved pending identity",async()=>{
    const state=new Map([["p1",{finalized:false,locked:false,placements:0,holds:0,capCredits:0,attempts:0}]]);
    const result=await executeRecoveryBatch(sharedRecovery(state,["p1"]));
    expect(result[0].status).toBe("RECOVERED");expect(state.get("p1")?.placements).toBe(1);
  });
  it("performs background-worker recovery deterministically",async()=>{
    const state=new Map([["p1",{finalized:false,locked:false,placements:0,holds:0,capCredits:0,attempts:0}]]);
    expect(await executeRecoveryBatch(sharedRecovery(state,["p1"]))).toEqual([
      expect.objectContaining({pendingId:"p1",status:"RECOVERED"}),
    ]);
  });
  it("prevents duplicate workers from processing one locked allocation",async()=>{
    const record={finalized:false,locked:true,placements:0,holds:0,capCredits:0,attempts:0};
    const state=new Map([["p1",record]]);
    const results=await Promise.all([
      executeRecoveryBatch(sharedRecovery(state,["p1"])),
      executeRecoveryBatch(sharedRecovery(state,["p1"])),
    ]);
    expect(results.flat().every(x=>x.status==="LOCKED")).toBe(true);expect(record.placements).toBe(0);
  });
  for(const phase of["placement","hold","cap"]){
    it(`recovers idempotently after a crash following ${phase}`,async()=>{
      const record:RecordState={finalized:false,locked:false,placements:0,holds:0,capCredits:0,attempts:0,failAt:phase};
      const state=new Map([["p1",record]]),adapter=sharedRecovery(state,["p1"]);
      expect((await executeRecoveryBatch(adapter))[0].status).toBe("FAILED");
      expect((await executeRecoveryBatch(adapter))[0].status).toBe("RECOVERED");
      expect(record.placements).toBe(1);
      expect(record.holds).toBeLessThanOrEqual(1);
      expect(record.capCredits).toBeLessThanOrEqual(1);
    });
  }
  it("admin retry is idempotent after worker recovery",async()=>{
    const record={finalized:false,locked:false,placements:0,holds:0,capCredits:0,attempts:0};
    const state=new Map([["p1",record]]),worker=sharedRecovery(state,["p1"]),admin=sharedRecovery(state,["p1"]);
    expect((await executeRecoveryBatch(worker))[0].status).toBe("RECOVERED");
    expect((await executeRecoveryBatch(admin))[0].status).toBe("SKIPPED");
    expect(record.placements).toBe(1);
  });
  it("coordinates independent service objects through shared lock state",async()=>{
    const record={finalized:false,locked:true,placements:0,holds:0,capCredits:0,attempts:0};
    const shared=new Map([["p1",record]]);
    const instanceA=sharedRecovery(shared,["p1"]),instanceB=sharedRecovery(shared,["p1"]);
    expect((await executeRecoveryBatch(instanceA))[0].status).toBe("LOCKED");
    record.locked=false;
    expect((await executeRecoveryBatch(instanceB))[0].status).toBe("RECOVERED");
  });
  it("skips an already finalized allocation",async()=>{
    const state=new Map([["p1",{finalized:true,locked:false,placements:1,holds:0,capCredits:1,attempts:0}]]);
    expect((await executeRecoveryBatch(sharedRecovery(state,["p1"])))[0].status).toBe("SKIPPED");
  });
  it("keeps root pending visible and unresolved",async()=>{
    const record={finalized:false,locked:false,placements:0,holds:0,capCredits:0,attempts:0,root:true};
    const state=new Map([["root-1",record]]);
    const result=(await executeRecoveryBatch(sharedRecovery(state,["root-1"])))[0];
    expect(result).toEqual(expect.objectContaining({status:"SKIPPED",terminalResult:"ROOT_PENDING"}));
    expect(record.finalized).toBe(false);
  });
  it("processes a deterministic pending list once each",async()=>{
    const state=new Map<string,RecordState>(["a","b","c"].map(id=>[id,{finalized:false,locked:false,placements:0,holds:0,capCredits:0,attempts:0}]));
    const results:RecoveryResult[]=await executeRecoveryBatch(sharedRecovery(state,["a","b","c"]));
    expect(results.map(x=>x.pendingId)).toEqual(["a","b","c"]);
    expect([...state.values()].every(x=>x.placements===1&&x.finalized)).toBe(true);
  });
});
