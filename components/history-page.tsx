"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Boxes, ChevronDown, Copy, ExternalLink, GitBranch, HandCoins, RefreshCw, Search, Users, Wallet } from "lucide-react";

type Item={
 id:string;type:string;category:string;amount:string|null;currency:string|null;sourceWallet:string|null;
 packageAmount:string|null;packageId:number|null;matrixType:string|null;cycle:number|null;recycleCount:number|null;
 status:string;txHash:string|null;createdAt:string;description:string;incomeType:string|null;level:number|null;
 position:number|null;metadata:Record<string,unknown>;
};
const filters=[["","All"],["PACKAGES","Packages"],["REFERRALS","Referrals"],["INCOME","Income"],["MATRIX","Matrix"],["AUTOPOOL","Autopool"],["BOOSTER","Booster"],["MAGIC","Magic"],["DIVIDEND","Dividend"],["WITHDRAWALS","Withdrawals"],["WALLET","Wallet"]] as const;
const icons:Record<string,typeof Activity>={PACKAGES:Boxes,REFERRALS:Users,INCOME:HandCoins,MATRIX:GitBranch,AUTOPOOL:GitBranch,BOOSTER:Activity,MAGIC:Activity,DIVIDEND:HandCoins,WITHDRAWALS:Wallet,WALLET:Wallet};
const short=(value:string)=>`${value.slice(0,6)}…${value.slice(-4)}`;
const money=(value:string|null)=>value===null?null:`${value} USDT`;

export default function HistoryPage(){
 const initial=typeof window==="undefined"?"":new URLSearchParams(window.location.search).get("category")||"";
 const[category,setCategory]=useState(initial),[status,setStatus]=useState(""),[search,setSearch]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState("");
 const[items,setItems]=useState<Item[]>([]),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[expanded,setExpanded]=useState(false);
 const load=useCallback(async(append=false)=>{setLoading(true);try{const params=new URLSearchParams({limit:"20"});if(category)params.set("category",category);if(status)params.set("status",status);if(search)params.set("q",search);if(from)params.set("from",from);if(to)params.set("to",to);if(append&&cursor)params.set("cursor",cursor);const response=await fetch(`/api/history?${params}`,{cache:"no-store",credentials:"same-origin"}),body=await response.json();if(!response.ok)throw new Error(body.error||"History unavailable");setItems(value=>append?[...value,...body.items]:body.items);setCursor(body.nextCursor);setError("")}catch(reason){setError(reason instanceof Error?reason.message:"History unavailable")}finally{setLoading(false)}},[category,status,search,from,to,cursor]);
 useEffect(()=>{void load(false)},[category]);
 function apply(){setCursor(null);void load(false)}
 return <div className="history-page">
  <section className="history-filter-bar smart-glass-card">
   <div className="history-filter-title"><div><p className="dash-label">HISTORY CENTER</p><h1>All Activity</h1></div><button type="button" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>Filters <ChevronDown size={14}/></button></div>
   <div className="history-category-scroll">{filters.map(([value,label])=><button type="button" className={category===value?"active":""} onClick={()=>{setCursor(null);setCategory(value)}} key={label}>{label}</button>)}</div>
   {expanded&&<div className="history-filter-fields">
    <label><span>Search</span><div><Search size={13}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Wallet, hash, package, income"/></div></label>
    <label><span>Status</span><select value={status} onChange={event=>setStatus(event.target.value)}><option value="">All statuses</option>{["CONFIRMED","ACTIVE","COMPLETED","CLAIMABLE","PENDING","FAILED","HELD","RELEASED"].map(value=><option key={value}>{value}</option>)}</select></label>
    <label><span>From</span><input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label>
    <label><span>To</span><input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label>
    <button type="button" className="history-apply" onClick={apply}>Apply Filters</button>
   </div>}
  </section>
  {error&&<section className="smart-glass-card history-empty"><p>{error}</p><button onClick={()=>void load(false)}><RefreshCw size={13}/>Retry</button></section>}
  <div className="history-timeline">{items.map(item=><HistoryCard item={item} key={item.id}/>)}</div>
  {!loading&&!error&&!items.length&&<section className="smart-glass-card history-empty">No verified history records found.</section>}
  {cursor&&<button type="button" disabled={loading} className="history-load-more" onClick={()=>void load(true)}>{loading?"Loading…":"Load more"}</button>}
 </div>
}

function HistoryCard({item}:{item:Item}){
 const Icon=icons[item.category]||Activity;
 return <article className="smart-glass-card history-record">
  <header><i><Icon size={15}/></i><div><b>{item.description}</b><small>{new Date(item.createdAt).toLocaleString()}</small></div><span>{item.status}</span></header>
  <div className="history-record-grid">
   {item.amount&&<Field label={item.type.includes("WITHDRAWAL")?"Amount":"Income amount"} value={money(item.amount)!} accent/>}
   {item.incomeType&&<Field label="Income category" value={item.incomeType.replaceAll("_"," ")}/>}
   {item.sourceWallet&&<div><small>Source wallet</small><b>{short(item.sourceWallet)} <button type="button" aria-label={`Copy ${item.sourceWallet}`} onClick={()=>void navigator.clipboard.writeText(item.sourceWallet!)}><Copy size={11}/></button></b></div>}
   {item.packageId&&<Field label="Package" value={`#${item.packageId}${item.packageAmount?` · ${money(item.packageAmount)}`:""}`}/>}
   {item.matrixType&&<Field label="Matrix type" value={item.matrixType}/>}
   {item.cycle&&<Field label="Cycle" value={`#${item.cycle}`}/>}
   {item.recycleCount&&<Field label="Recycled" value={`${item.recycleCount} times ♻️`}/>}
   {item.level&&<Field label="Level" value={String(item.level)}/>}
   {item.position&&<Field label="Position" value={String(item.position)}/>}
   {typeof item.metadata.relationshipLevel==="number"&&<Field label="Relationship level" value={String(item.metadata.relationshipLevel)}/>}
   {typeof item.metadata.cycleEarnings==="string"&&<Field label="Cycle earnings" value={`${item.metadata.cycleEarnings} USDT`} accent/>}
   {Array.isArray(item.metadata.positionWallets)&&<Field label="Position wallets" value={item.metadata.positionWallets.map(value=>short(String(value))).join(", ")||"None"}/>}
   {typeof item.metadata.directIncomeGenerated==="string"&&<Field label="Direct income generated" value={`${item.metadata.directIncomeGenerated} USDT`} accent/>}
   {typeof item.metadata.firstPackageAt==="string"&&<Field label="First package date" value={new Date(item.metadata.firstPackageAt).toLocaleString()}/>}
   {typeof item.metadata.fee==="string"&&<Field label="Fee / Net" value={`${item.metadata.fee} / ${String(item.metadata.netAmount||"0.00")} USDT`}/>}
   {typeof item.metadata.rejectionReason==="string"&&item.metadata.rejectionReason&&<Field label="Rejection reason" value={item.metadata.rejectionReason}/>}
   {typeof item.metadata.parentWallet==="string"&&<Field label="Parent wallet" value={short(item.metadata.parentWallet)}/>}
   {typeof item.metadata.nextEligibleAt==="string"&&<Field label="Next eligible" value={new Date(item.metadata.nextEligibleAt).toLocaleString()}/>}
  </div>
  {item.txHash&&<a className="history-reference" href={item.txHash.startsWith("0x")?`https://testnet.bscscan.com/tx/${item.txHash}`:"#"} target={item.txHash.startsWith("0x")?"_blank":undefined} rel="noreferrer"><span>{item.txHash.startsWith("0x")?short(item.txHash):item.txHash}</span>{item.txHash.startsWith("0x")&&<ExternalLink size={12}/>}</a>}
 </article>
}
function Field({label,value,accent=false}:{label:string;value:string;accent?:boolean}){return <div><small>{label}</small><b className={accent?"positive":""}>{value}</b></div>}
