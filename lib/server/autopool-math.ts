export const AUTOPOOL_INCOME=100_000n;
export const AUTOPOOL_LEVEL_CAPACITIES=[2,6,18,54,162] as const;
export const AUTOPOOL_TOTAL_POSITIONS=AUTOPOOL_LEVEL_CAPACITIES.reduce((a,b)=>a+b,0);

export function autopoolCoordinates(position:number){
 if(!Number.isInteger(position)||position<1||position>AUTOPOOL_TOTAL_POSITIONS)throw new RangeError("Autopool position must be between 1 and 242");
 let before=0;
 for(let index=0;index<AUTOPOOL_LEVEL_CAPACITIES.length;index++){
  const capacity=AUTOPOOL_LEVEL_CAPACITIES[index];
  if(position<=before+capacity){
   const level=index+1,levelPosition=position-before;
   if(level===1)return{level,levelPosition,parentPosition:null,childSlot:levelPosition};
   const previousStart=before-AUTOPOOL_LEVEL_CAPACITIES[index-1]+1;
   return{level,levelPosition,parentPosition:previousStart+Math.floor((levelPosition-1)/3),childSlot:(levelPosition-1)%3+1};
  }
  before+=capacity;
 }
 throw new RangeError("Invalid Autopool position");
}
