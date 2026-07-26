export const DIVIDEND_MINIMUM_PRINCIPAL=8_000_000n;
export const DIVIDEND_RATE_DENOMINATOR=100n;
export function dailyTarget(principal:bigint){if(principal<DIVIDEND_MINIMUM_PRINCIPAL)throw new RangeError("Package is not Dividend eligible");return principal/DIVIDEND_RATE_DENOMINATOR}
export function dividendShortfall(target:bigint,otherIncome:bigint){return target>otherIncome?target-otherIncome:0n}
export function allocateOldestFirst(shortfall:bigint,packages:{id:string;dailyTarget:bigint;remainingCap:bigint}[]){let remaining=shortfall;const allocations=[] as {packageId:string;amount:bigint}[];for(const item of packages){const amount=[remaining,item.dailyTarget,item.remainingCap].reduce((a,b)=>a<b?a:b);if(amount>0n){allocations.push({packageId:item.id,amount});remaining-=amount}if(!remaining)break}return allocations}

export type DividendWindowPackage={id:string;activatedAt:Date;applicableStart:Date;applicableEnd:Date;dailyTarget:bigint};
export type DividendIncomeEvent={id:string;occurredAt:Date;amount:bigint};
export function attributeIncomeOldestFirst(packages:DividendWindowPackage[],events:DividendIncomeEvent[]){
 const remaining=new Map(packages.map(p=>[p.id,p.dailyTarget]));
 const allocations:{eventId:string;packageId:string;amount:bigint}[]=[];
 const orderedPackages=[...packages].sort((a,b)=>a.activatedAt.getTime()-b.activatedAt.getTime()||a.id.localeCompare(b.id));
 const orderedEvents=[...events].sort((a,b)=>a.occurredAt.getTime()-b.occurredAt.getTime()||a.id.localeCompare(b.id));
 for(const event of orderedEvents){let unallocated=event.amount;for(const pkg of orderedPackages){if(!unallocated)break;if(event.occurredAt<pkg.applicableStart||event.occurredAt>=pkg.applicableEnd)continue;const targetRemaining=remaining.get(pkg.id)??0n;if(!targetRemaining)continue;const amount=unallocated<targetRemaining?unallocated:targetRemaining;if(amount>0n){allocations.push({eventId:event.id,packageId:pkg.id,amount});remaining.set(pkg.id,targetRemaining-amount);unallocated-=amount}}}
 return{allocations,attributedByPackage:new Map(packages.map(p=>[p.id,p.dailyTarget-(remaining.get(p.id)??0n)]))};
}

function parts(date:Date,timeZone:string){const values=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date);return Object.fromEntries(values.map(x=>[x.type,x.value])) as Record<string,string>}
export function businessDateAt(date:Date,timeZone:string){const p=parts(date,timeZone);return`${p.year}-${p.month}-${p.day}`}
export function previousBusinessDate(date:Date,timeZone:string){const p=businessDateAt(date,timeZone);const noon=new Date(`${p}T12:00:00Z`);noon.setUTCDate(noon.getUTCDate()-1);return businessDateAt(noon,timeZone)}
export function businessDayBounds(date:string,timeZone:string){const desired=Date.parse(`${date}T00:00:00Z`);let guess=desired;for(let i=0;i<3;i++){const p=parts(new Date(guess),timeZone);const represented=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);guess+=desired-represented}return{start:new Date(guess),end:new Date(guess+86_400_000)}}
