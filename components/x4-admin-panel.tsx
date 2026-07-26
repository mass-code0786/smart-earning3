"use client";
import{useEffect,useState}from"react";
import{RefreshCw,Search}from"lucide-react";
import{formatTokenUnits}from"@/lib/client/money";
const reports=["cycles","queues","placements","recycles","income","audit"] as const;
type Summary={memberships:number;active_cycles:number;completed_cycles:number;placements:number;recycles:number;magic_income:string;level2_income:string;capped_excess:string};
const money=(value:string)=>formatTokenUnits(value||"0");
export function X4AdminPanel(){
  const[summary,setSummary]=useState<Summary|null>(null),[report,setReport]=useState<(typeof reports)[number]>("cycles");
  const[items,setItems]=useState<Record<string,unknown>[]>([]),[query,setQuery]=useState(""),[packageId,setPackageId]=useState("");
  const[error,setError]=useState("");
  async function load(){
    try{
      const params=new URLSearchParams();if(query)params.set("q",query);if(packageId)params.set("package",packageId);
      const[s,r]=await Promise.all([fetch("/api/admin/x4/summary",{cache:"no-store"}),fetch(`/api/admin/x4/${report}?${params}`,{cache:"no-store"})]);
      const[sb,rb]=await Promise.all([s.json(),r.json()]);if(!s.ok||!r.ok)throw new Error(sb.error||rb.error||"X4 administration unavailable");
      setSummary(sb);setItems(rb.items||[]);setError("");
    }catch(reason){setError(reason instanceof Error?reason.message:"X4 administration unavailable")}
  }
  useEffect(()=>{void load()},[report,packageId]);
  return <section className="smart-glass-card mt-5 rounded-[22px] p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="dash-label">GLOBAL MATRIX</p><h2 className="text-lg font-bold">X4 Management</h2></div>
      <button onClick={load} className="flex items-center gap-2 text-xs text-[#00f77a]"><RefreshCw size={14}/>Refresh</button></div>
    {error&&<p className="mt-3 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-300">{error}</p>}
    {summary&&<div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
      <Tile label="Active cycles" value={summary.active_cycles}/><Tile label="Completed" value={summary.completed_cycles}/>
      <Tile label="Placements" value={summary.placements}/><Tile label="Recycles" value={summary.recycles}/>
      <Tile label="Memberships" value={summary.memberships}/><Tile label="Magic income" value={money(summary.magic_income)}/>
      <Tile label="Level 2 income" value={money(summary.level2_income)}/><Tile label="Capped excess" value={money(summary.capped_excess)}/>
    </div>}
    <div className="mt-4 flex flex-wrap gap-2">{reports.map(value=><button key={value} onClick={()=>setReport(value)}
      className={`rounded-xl border px-3 py-2 text-[10px] uppercase ${report===value?"border-[#00f77a]/30 bg-[#00f77a]/10 text-[#00f77a]":"border-white/10 text-[#8b9d94]"}`}>{value}</button>)}</div>
    <div className="mt-3 flex flex-wrap gap-2"><label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-white/10 px-3"><Search size={14}/>
      <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&void load()} placeholder="Wallet, user, cycle or audit search" className="w-full bg-transparent py-3 text-xs outline-none"/></label>
      <select aria-label="X4 package filter" value={packageId} onChange={e=>setPackageId(e.target.value)} className="rounded-xl border border-white/10 bg-[#07110c] px-3 text-xs">
        <option value="">All packages</option>{Array.from({length:8},(_,index)=><option key={index+1} value={index+1}>Package {index+1}</option>)}</select>
      <button onClick={load} className="rounded-xl bg-[#00f77a] px-4 text-xs font-bold text-[#020705]">Search</button></div>
    <div className="mt-4 max-h-[420px] overflow-auto"><table className="w-full min-w-[720px] text-left text-[10px]"><thead className="sticky top-0 bg-[#07110c] text-[#8b9d94]">
      <tr><th className="p-2">Wallet</th><th>Package</th><th>Status / Type</th><th>Cycle / Position</th><th>Created</th><th>Record ID</th></tr></thead>
      <tbody>{items.map((item,index)=><tr className="border-t border-white/5" key={String(item.id||index)}><td className="max-w-[150px] truncate p-2">{String(item.wallet_address||"—")}</td>
        <td>{String(item.package_id||"—")}</td><td>{String(item.status||item.event_type||item.wallet_type||item.placement_type||"—")}</td>
        <td>{String(item.cycle_number||item.slot_number||item.cycle_id||"—")}</td><td>{formatDate(item.created_at||item.opened_at||item.enqueued_at)}</td>
        <td className="max-w-[170px] truncate">{String(item.id||"—")}</td></tr>)}</tbody></table>
      {!items.length&&<p className="py-5 text-xs text-[#8b9d94]">No matching X4 records.</p>}</div>
  </section>
}
function Tile({label,value}:{label:string;value:string|number}){return <div className="rounded-xl border border-white/5 bg-black/20 p-3"><span className="block text-[9px] uppercase text-[#8b9d94]">{label}</span><b className="mt-1 block text-sm text-[#00f77a]">{value}</b></div>}
function formatDate(value:unknown){if(!value)return"—";const date=new Date(String(value));return Number.isNaN(date.valueOf())?"—":date.toLocaleString()}
