export const BOOSTER_ENTRY_COST=2_500_000n;
export const BOOSTER_INCOME=2_000_000n;
export const BOOSTER_INTERVAL_MS=4*60*60*1000;
export function boosterPackageCredit(amount:bigint){
  if(amount<=0n||amount%16n!==0n)throw new Error("Package amount is not exactly divisible");
  return amount*5n/16n;
}
export function boosterBalance(rows:{direction:"CREDIT"|"DEBIT";amount:string}[]){
  return rows.reduce((sum,row)=>sum+(row.direction==="CREDIT"?BigInt(row.amount):-BigInt(row.amount)),0n);
}
export function boosterScheduledFor(lastEntryAt:Date|null,createdAt:Date){
  return lastEntryAt?new Date(lastEntryAt.getTime()+BOOSTER_INTERVAL_MS):createdAt;
}
