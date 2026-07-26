export const X4_PACKAGE_PRICES=[8n,16n,32n,64n,128n,256n,512n,1024n].map(
  (dollars,index)=>({packageId:index+1,price:dollars*1_000_000n}),
);

export function x4Income(amount:bigint,level:1|2){
  if(amount<=0n||amount%32n!==0n)throw new Error("X4 package amount must be a positive multiple of 32 token units");
  return level===1?amount/16n:amount*5n/32n;
}

export function x4LevelForSlot(slot:number):1|2{
  if(!Number.isInteger(slot)||slot<1||slot>6)throw new Error("X4 slot must be between 1 and 6");
  return slot<=2?1:2;
}

export type X4QueueNode={id:string;slots:string[]};
export function simulateX4Placement(queue:X4QueueNode[],cycleId:string){
  const receiver=queue.find(node=>node.id!==cycleId&&node.slots.length<6);
  if(!receiver)return{root:true,receiverId:null,slot:null,level:null,completed:false};
  const slot=receiver.slots.length+1;
  receiver.slots.push(cycleId);
  return{root:false,receiverId:receiver.id,slot,level:x4LevelForSlot(slot),completed:slot===6};
}
