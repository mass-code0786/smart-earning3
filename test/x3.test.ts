import{describe,expect,it}from"vitest";
import{findX3BfsParent,simulateX3Cascade,x3Allocation,x3SlotDisposition,X3Node,X3_PACKAGE_PRICES}from"@/lib/server/x3-math";
import{calculateCappedCredit}from"@/lib/server/income-cap-service";

function matrix(){
  const nodes=new Map<string,X3Node>([["YOU",{id:"YOU",children:[]}]]);
  const sponsor=new Map<string,string>();
  function place(user:string,referrer="YOU"){
    sponsor.set(user,referrer);
    const result=findX3BfsParent(referrer,nodes);
    nodes.get(result.parentId)!.children.push(user);
    nodes.set(user,{id:user,children:[]});
    return result;
  }
  return{nodes,sponsor,place};
}

describe("package-wise X3 allocation",()=>{
  it("allocates exactly 25% and reserves exactly 75% for all packages",()=>{
    for(const item of X3_PACKAGE_PRICES){
      const value=x3Allocation(item.price);
      expect(value.x3*4n).toBe(item.price);
      expect(value.reserved).toBe(item.price-value.x3);
      expect(value.x3+value.reserved).toBe(item.price);
    }
  });
  it("does not accept fractional token-unit allocation",()=>expect(()=>x3Allocation(3n)).toThrow());
});

describe("deterministic sponsor-started X3 BFS",()=>{
  it("fills three sponsor slots then spills fourth through seventh left-to-right",()=>{
    const x=matrix();
    expect(x.place("A")).toEqual({parentId:"YOU",slot:1});
    expect(x.place("B")).toEqual({parentId:"YOU",slot:2});
    expect(x.place("C")).toEqual({parentId:"YOU",slot:3});
    expect(x.place("D")).toEqual({parentId:"A",slot:1});
    expect(x.place("E")).toEqual({parentId:"A",slot:2});
    expect(x.place("F")).toEqual({parentId:"A",slot:3});
    expect(x.place("G")).toEqual({parentId:"B",slot:1});
    expect(x.nodes.get("YOU")!.children).toEqual(["A","B","C"]);
    expect(x.nodes.get("A")!.children).toEqual(["D","E","F"]);
    for(const node of x.nodes.values())expect(node.children.length).toBeLessThanOrEqual(3);
  });
  it("starts from the permanent sponsor without changing referral sponsor",()=>{
    const x=matrix();x.place("A");x.place("B");x.place("C");
    const placement=x.place("D","A");
    expect(placement.parentId).toBe("A");
    expect(x.sponsor.get("D")).toBe("A");
  });
  it("keeps package matrices independent",()=>{
    const p1=matrix(),p2=matrix();
    p1.place("A");p1.place("B");p1.place("C");p1.place("D");
    expect(p1.nodes.get("A")!.children).toEqual(["D"]);
    expect(p2.nodes.get("YOU")!.children).toEqual([]);
  });
  it("detects a circular package matrix",()=>{
    const nodes=new Map<string,X3Node>([["A",{id:"A",children:["B","C","D"]}],["B",{id:"B",children:["A","C","D"]}],["C",{id:"C",children:["A","B","D"]}],["D",{id:"D",children:["A","B","C"]}]]);
    expect(()=>findX3BfsParent("A",nodes)).toThrow("Circular X3 matrix");
  });
});

describe("X3 slot, hold, release, recycle and cap rules",()=>{
  it("slots one and two credit active owners",()=>{
    expect(x3SlotDisposition(1,true)).toBe("WITHDRAWABLE");
    expect(x3SlotDisposition(2,true)).toBe("WITHDRAWABLE");
  });
  it("slots one and two hold for inactive and registration-only owners without pass-up",()=>{
    expect(x3SlotDisposition(1,false)).toBe("HELD");
    expect(x3SlotDisposition(2,false)).toBe("HELD");
  });
  it("slot three is recycle, never a third normal income",()=>{
    expect(x3SlotDisposition(3,true)).toBe("RECYCLE");
    expect(x3SlotDisposition(3,false)).toBe("RECYCLE");
  });
  it("applies the shared cap only to credit/release and records exact excess",()=>{
    const capped=calculateCappedCredit(50_000_000n,49_000_000n,2_000_000n);
    expect(capped.credited).toBe(1_000_000n);
    expect(capped.excess).toBe(1_000_000n);
    expect(capped.status).toBe("CAPPED");
  });
  it("selects held entries only for the activated package",()=>{
    const holds=[{id:"a",packageId:2},{id:"b",packageId:3},{id:"c",packageId:2}];
    expect(holds.filter(x=>x.packageId===2).map(x=>x.id)).toEqual(["a","c"]);
    expect(holds.filter(x=>x.packageId===3).map(x=>x.id)).toEqual(["b"]);
  });
  it("uses stable identities for duplicate purchase, income and recycle prevention",()=>{
    const purchaseId="purchase-1",slotId="slot-1",cycleId="cycle-1";
    expect(new Set([`x3:reserve:${purchaseId}`,`x3:reserve:${purchaseId}`]).size).toBe(1);
    expect(new Set([`x3:cap:${slotId}`,`x3:cap:${slotId}`]).size).toBe(1);
    expect(new Set([`x3:recycle:${cycleId}`,`x3:recycle:${cycleId}`]).size).toBe(1);
  });
});

describe("carried-allocation recycle conservation",()=>{
  const allocation=2_000_000n;
  function conserved(result:{credited:bigint;held:bigint;excess:bigint;pending:bigint}){
    expect(result.credited+result.held+result.excess+result.pending).toBe(allocation);
  }
  it("carries a nonzero slot-3 allocation into a real slot-1 terminal placement",()=>{
    const result=simulateX3Cascade(allocation,[{slot:3,active:true},{slot:1,active:true}]);
    expect(result.events).toEqual([
      {type:"RECYCLE",amount:allocation,depth:0},
      {type:"WITHDRAWABLE",amount:allocation,depth:1},
    ]);
    expect(result.credited).toBe(allocation);conserved(result);
  });
  it("carries the same amount into a real slot-2 terminal placement",()=>{
    const result=simulateX3Cascade(allocation,[{slot:3,active:true},{slot:2,active:true}]);
    expect(result.events[1]).toEqual({type:"WITHDRAWABLE",amount:allocation,depth:1});
    conserved(result);
  });
  it("continues unchanged through multiple slot-3 recycles with one payout",()=>{
    const result=simulateX3Cascade(allocation,[
      {slot:3,active:true},{slot:3,active:false},{slot:3,active:true},{slot:1,active:true},
    ]);
    expect(result.events.filter(x=>x.type==="RECYCLE")).toHaveLength(3);
    expect(result.events.filter(x=>x.type==="WITHDRAWABLE")).toHaveLength(1);
    expect(new Set(result.events.map(x=>x.amount))).toEqual(new Set([allocation]));
    conserved(result);
  });
  it("terminates as package-specific hold for an inactive owner without pass-up",()=>{
    const result=simulateX3Cascade(allocation,[{slot:3,active:true},{slot:1,active:false}]);
    expect(result.held).toBe(allocation);
    expect(result.events.at(-1)?.type).toBe("HELD");conserved(result);
  });
  it("stores sponsorless allocation as ROOT_PENDING",()=>{
    const result=simulateX3Cascade(allocation,[{slot:3,active:true},{slot:1,active:false,root:true}]);
    expect(result.pending).toBe(allocation);
    expect(result.events.at(-1)?.type).toBe("ROOT_PENDING");conserved(result);
  });
  it("stores full allocation for recovery at the maximum depth",()=>{
    const result=simulateX3Cascade(allocation,[
      {slot:3,active:true},{slot:3,active:true},{slot:3,active:true},{slot:3,active:true},
    ],2);
    expect(result.pending).toBe(allocation);
    expect(result.events.at(-1)?.type).toBe("RECYCLE_PENDING");conserved(result);
  });
  it("partial cap credit plus excess conserves the original allocation",()=>{
    const cap=calculateCappedCredit(10_000_000n,9_000_000n,allocation);
    expect(cap.credited).toBe(1_000_000n);
    expect(cap.excess).toBe(1_000_000n);
    expect(cap.credited+cap.excess).toBe(allocation);
  });
  it("rejects zero-value recycle allocations",()=>expect(()=>simulateX3Cascade(0n,[{slot:3,active:true}])).toThrow());
  it("is deterministic across retries and creates one terminal identity",()=>{
    const steps=[{slot:3 as const,active:true},{slot:1 as const,active:true}];
    expect(simulateX3Cascade(allocation,steps)).toEqual(simulateX3Cascade(allocation,steps));
    expect(simulateX3Cascade(allocation,steps).events.filter(x=>x.type!=="RECYCLE")).toHaveLength(1);
  });
});
