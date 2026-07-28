"use client";
import{useEffect,useState}from"react";
import{AlertTriangle,Globe2,RefreshCw,RotateCw}from"lucide-react";
type Slot={slotNumber:number;level:number;wallet:string;placementType:string};
type Package={packageId:number;priceTokenUnits:string;active:boolean;currentCycle:number;cycleStatus:string;
  slots:Slot[];filledPositions:number;emptyPositions:number;recycleCount:number;magicLevelIncome:string;
  level2Income:string;cappedExcess:string;totalEarnings:string};
type History={id:string;type:string;package_id:number;level:number|null;status:string;amount:string;created_at:string};
const money=(value:string)=>{const n=BigInt(value),whole=n/1_000_000n,fraction=(n%1_000_000n).toString().padStart(6,"0").slice(0,2);return`$${whole}.${fraction}`};
const shortWallet=(value:string)=>`${value.slice(0,6)}…${value.slice(-4)}`;
export function X4Page(){
  const[data,setData]=useState<{packages:Package[];history:History[]}|null>(null),[error,setError]=useState("");
  async function load(){try{const response=await fetch("/api/x4/packages",{cache:"no-store"}),body=await response.json();
    if(!response.ok)throw new Error(body.error||"X4 data unavailable");setData(body);setError("")}
    catch(reason){setError(reason instanceof Error?reason.message:"X4 data unavailable")}}
  useEffect(()=>{void load()},[]);
  if(!data)return <section className="smart-glass-card rounded-[22px] p-5"><AlertTriangle className="text-[#e9ad45]"/>
    <p className="mt-3 text-sm">{error||"Loading global X4 matrices..."}</p>
    <button onClick={load} className="mt-3 flex items-center gap-2 text-xs text-[#00f77a]"><RefreshCw size={14}/>Retry</button></section>;
  return <div className="grid gap-4">
    <section className="smart-glass-card rounded-[22px] p-5"><div className="flex items-center gap-2"><Globe2 size={18} className="text-[#00f77a]"/>
      <div><p className="dash-label">GLOBAL PLACEMENT</p><h1 className="text-xl font-bold">X4 Global Matrix</h1></div></div>
      <p className="mt-2 text-xs text-[#8b9d94]">Each package has one independent global, level-order queue.</p></section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{data.packages.map(item=><article className="smart-glass-card min-w-0 rounded-[22px] p-5" key={item.packageId}>
      <div className="flex items-center justify-between gap-2"><b className="truncate">Package {item.packageId} · {money(item.priceTokenUnits)}</b>
        <span className={`rounded-full border px-2 py-1 text-[9px] ${item.active?"border-[#00f77a]/30 text-[#00f77a]":"border-white/10 text-[#8b9d94]"}`}>{item.active?"ACTIVE":"LOCKED"}</span></div>
      <div className="mx-auto mt-4 grid max-w-[260px] grid-cols-4 gap-2">
        {[1,2].map(slot=>{const value=item.slots.find(x=>x.slotNumber===slot);return <MatrixSlot key={slot} slot={slot} value={value} className={slot===1?"col-start-1 col-span-2":"col-span-2"}/>})}
        {[3,4,5,6].map(slot=><MatrixSlot key={slot} slot={slot} value={item.slots.find(x=>x.slotNumber===slot)}/>)}
      </div>
      <div className="mt-4 grid gap-1 text-[10px] text-[#8b9d94]">
        <Stat label="Current cycle number" value={`#${item.currentCycle}`}/><Stat label="Current cycle status" value={item.cycleStatus}/>
        <Stat label="Filled positions / total positions" value={`${item.filledPositions} / 6`}/>
        <Stat label="Recycled" value={`${item.recycleCount} times ♻️`}/><Stat label="Magic Level income" value={money(item.magicLevelIncome)} accent/>
        <Stat label="Level 2 income" value={money(item.level2Income)} accent/><Stat label="Total earning" value={`${money(item.totalEarnings)} USDT`} accent/>
      </div></article>)}</div>
    <section className="smart-glass-card overflow-hidden rounded-[22px] p-5"><div className="flex items-center gap-2"><RotateCw size={16} className="text-[#00f77a]"/><h2 className="font-bold">Complete X4 History</h2></div>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[540px] text-left text-xs"><thead className="text-[#8b9d94]"><tr><th className="pb-3">Event</th><th>Package</th><th>Level</th><th>Status</th><th>Amount</th><th>Date</th></tr></thead>
        <tbody>{data.history.map(row=><tr className="border-t border-white/5" key={row.id}><td className="py-3">{row.type}</td><td>{row.package_id}</td><td>{row.level||"—"}</td><td>{row.status}</td><td className="text-[#00f77a]">{money(row.amount)}</td><td>{new Date(row.created_at).toLocaleString()}</td></tr>)}</tbody></table>
        {!data.history.length&&<p className="py-5 text-xs text-[#8b9d94]">No X4 history yet.</p>}</div></section>
  </div>
}
function MatrixSlot({slot,value,className=""}:{slot:number;value?:Slot;className?:string}){return <div className={`${className} min-w-0 rounded-xl border p-2 text-center text-[9px] ${value?"border-[#00f77a]/30 bg-[#00f77a]/5":"border-dashed border-white/10"}`}>
  <b className="block">L{slot<=2?1:2} · {slot}</b><span className="block truncate text-[#8b9d94]">{value?shortWallet(value.wallet):"Empty"}</span></div>}
function Stat({label,value,accent=false}:{label:string;value:string;accent?:boolean}){return <span>{label}<b className={`float-right ${accent?"text-[#00f77a]":"text-white"}`}>{value}</b></span>}
