export const X3_PACKAGE_PRICES = [8n,16n,32n,64n,128n,256n,512n,1024n].map(
  (dollars, index) => ({ packageId: index + 1, price: dollars * 1_000_000n }),
);

export function x3Allocation(packageAmount: bigint) {
  if (packageAmount <= 0n || packageAmount % 4n !== 0n) {
    throw new Error("Package amount must divide exactly into a 25% X3 allocation");
  }
  return { x3: packageAmount / 4n, reserved: packageAmount * 3n / 4n };
}

export type X3Node = { id:string; children:string[] };
export function findX3BfsParent(rootId:string, nodes:Map<string,X3Node>) {
  const queue=[rootId],seen=new Set<string>();
  for(let head=0;head<queue.length;head++){
    const id=queue[head];
    if(seen.has(id))throw new Error("Circular X3 matrix");
    seen.add(id);
    const node=nodes.get(id);
    if(!node)throw new Error("Missing X3 matrix node");
    if(node.children.length<3)return{parentId:id,slot:node.children.length+1};
    queue.push(...node.children);
  }
  throw new Error("No X3 position available");
}

export function x3SlotDisposition(slot:1|2|3,ownerPackageActive:boolean) {
  if(slot===3)return"RECYCLE" as const;
  return ownerPackageActive?"WITHDRAWABLE" as const:"HELD" as const;
}

export type CascadeStep={slot:1|2|3;active:boolean;root?:boolean};
export function simulateX3Cascade(allocation:bigint,steps:CascadeStep[],maxDepth=32){
  if(allocation<=0n)throw new Error("X3 allocation must be positive");
  const events:{type:string;amount:bigint;depth:number}[]=[];
  for(let depth=0;depth<steps.length;depth++){
    const step=steps[depth];
    if(depth>maxDepth){
      events.push({type:"RECYCLE_PENDING",amount:allocation,depth});
      return{events,credited:0n,held:0n,excess:0n,pending:allocation};
    }
    if(step.root){
      events.push({type:"ROOT_PENDING",amount:allocation,depth});
      return{events,credited:0n,held:0n,excess:0n,pending:allocation};
    }
    if(step.slot===3){
      events.push({type:"RECYCLE",amount:allocation,depth});
      continue;
    }
    const type=step.active?"WITHDRAWABLE":"HELD";
    events.push({type,amount:allocation,depth});
    return{events,credited:step.active?allocation:0n,held:step.active?0n:allocation,excess:0n,pending:0n};
  }
  events.push({type:"RECYCLE_PENDING",amount:allocation,depth:steps.length});
  return{events,credited:0n,held:0n,excess:0n,pending:allocation};
}
