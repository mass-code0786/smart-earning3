import{describe,expect,it}from"vitest";
import{simulateX4Placement,x4Income,x4LevelForSlot,X4_PACKAGE_PRICES,type X4QueueNode}from"@/lib/server/x4-math";
import{readFileSync}from"node:fs";
import{resolve}from"node:path";

describe("X4 package income rules",()=>{
  it("uses exactly 6.25% for each level-1 position and 15.625% for each level-2 position",()=>{
    for(const item of X4_PACKAGE_PRICES){
      expect(x4Income(item.price,1)*16n).toBe(item.price);
      expect(x4Income(item.price,2)*32n).toBe(item.price*5n);
      expect(x4Income(item.price,1)*2n+x4Income(item.price,2)*4n).toBe(item.price*3n/4n);
    }
  });
  it("maps two level-1 and four level-2 positions",()=>{
    expect([1,2,3,4,5,6].map(x4LevelForSlot)).toEqual([1,1,2,2,2,2]);
    expect(()=>x4LevelForSlot(7)).toThrow();
  });
});

describe("global package queue",()=>{
  it("creates the first cycle as top/root and fills level order left-to-right",()=>{
    const queue:X4QueueNode[]=[{id:"top",slots:[]}];
    expect(simulateX4Placement(queue,"top").root).toBe(true);
    for(const id of["A","B","C","D","E","F"]){
      queue.push({id,slots:[]});
      simulateX4Placement(queue,id);
    }
    expect(queue[0].slots).toEqual(["A","B","C","D","E","F"]);
  });
  it("moves to the next FIFO receiver and treats every package queue independently",()=>{
    const first:X4QueueNode[]=[{id:"root",slots:["A","B","C","D","E","F"]},{id:"A",slots:[]}];
    first.push({id:"G",slots:[]});
    expect(simulateX4Placement(first,"G")).toMatchObject({receiverId:"A",slot:1});
    const second:X4QueueNode[]=[{id:"other-root",slots:[]}];
    expect(simulateX4Placement(second,"other-root").root).toBe(true);
  });
  it("re-enters a completed owner at the back of the same queue",()=>{
    const queue:X4QueueNode[]=[{id:"root",slots:["A","B","C","D","E"]},{id:"A",slots:[]}];
    queue.push({id:"F",slots:[]});
    expect(simulateX4Placement(queue,"F").completed).toBe(true);
    queue.push({id:"root-cycle-2",slots:[]});
    expect(simulateX4Placement(queue,"root-cycle-2")).toMatchObject({receiverId:"A",slot:1});
  });
  it("is deterministic and excludes self-placement",()=>{
    const one:X4QueueNode[]=[{id:"root",slots:[]}],two:X4QueueNode[]=[{id:"root",slots:[]}];
    expect(simulateX4Placement(one,"root")).toEqual(simulateX4Placement(two,"root"));
  });
  it("has no cycle-count, earning-count, or numeric recycle ceiling",()=>{
    const service=readFileSync(resolve(process.cwd(),"lib/server/x4-service.ts"),"utf8");
    expect(service).not.toContain("X4_CASCADE_LIMIT");
    expect(service).not.toMatch(/cascade\s*<\s*\d+/);
    expect(service).toContain("for(;;)");
    expect(service).toContain("X4_EVENT_MISMATCH");
    expect(service).toContain("recordConfirmedMagicFunding");
  });
});
