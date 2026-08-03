"use client";
import{useCallback,useEffect,useRef,useState}from"react";
import{Clock,RefreshCw,Wallet}from"lucide-react";
import{topUpBoosterWalletOnTestnet}from"@/lib/client/wallet";
import{boosterAmountTokenUnits,normalizeBoosterAmountInput}from"@/lib/client/booster-topup";
import{BoosterCountdown,type BoosterEligibility}from"@/components/booster-countdown";
import{formatTokenUnits}from"@/lib/client/money";
import{MatrixHistoryMenu}from"@/components/matrix-history-menu";
type Entry={id:string;cycle_number:number;status:string;positions:{slotNumber:number;wallet:string}[];created_at:string;completed_at:string|null};
type TopUp={id:string;amount:string;source_reference:string|null;tx_hash:string;status:string;sender_address:string;created_at:string;previous_balance:string|null;new_balance:string|null};
type Data={balance:string;package_credits:string;manual_top_ups:string;refunds:string;deductions:string;nextEntryAt:string|null;
 server_time:string;next_entry_at:string|null;booster_wallet_balance:string;eligibility:BoosterEligibility;status:BoosterEligibility;
 boosterActive:boolean;lastRunAt:string|null;nextEligibleAt:string|null;remainingSeconds:number;
 active_entries:number;completed_entries:number;total_entries:number;pending_positions:number;total_income:string;entries:Entry[];
 walletHistory:{id:string;direction:string;amount:string;reason:string;created_at:string}[];entryHistory:{id:string;type:string;slot_number:number;amount:string;created_at:string}[];
 topUpHistory:TopUp[]};
type Preparation={amountTokenUnits:string;availableBalanceTokenUnits:string;network:string;chainId:number;gasCurrency:string};
const money=(value:string)=>formatTokenUnits(value);
const quick=["2.50","5","10","25","50"];

export function BoosterPage(){
 const[data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[amount,setAmount]=useState(""),[amountError,setAmountError]=useState("");
 const[busy,setBusy]=useState(false),[status,setStatus]=useState(""),[txHash,setTxHash]=useState(""),[available,setAvailable]=useState<string|null>(null);
 const[preparation,setPreparation]=useState<Preparation|null>(null),locked=useRef(false),input=useRef<HTMLInputElement>(null);
 const load=useCallback(async()=>{try{const response=await fetch("/api/booster",{cache:"no-store"}),body=await response.json();if(!response.ok)throw new Error(body.error||"Booster unavailable");setData(body);setError("")}catch(reason){setError(reason instanceof Error?reason.message:"Booster unavailable")}},[]);
 useEffect(()=>{void load()},[load]);
 function changeAmount(raw:string){const normalized=normalizeBoosterAmountInput(raw);if(normalized===null){setAmountError("Use numbers with up to 6 decimal places");return}setAmount(normalized);setAmountError("")}
 async function prepare(){
  if(busy||locked.current)return;
  try{
   const amountTokenUnits=boosterAmountTokenUnits(amount);setBusy(true);setAmountError("");setStatus("");
   const response=await fetch("/api/booster/top-up/prepare",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({amountTokenUnits:amountTokenUnits.toString()})}),body=await response.json();
   if(!response.ok)throw new Error(body.error||"Booster top-up could not be prepared");
   setAvailable(body.availableBalanceTokenUnits);setPreparation(body);
  }catch(reason){setAmountError(reason instanceof Error?reason.message:"Enter a valid top-up amount")}finally{setBusy(false)}
 }
 async function confirm(){
  if(!preparation||busy||locked.current)return;locked.current=true;setBusy(true);setTxHash("");
  try{
   const exactAmount=BigInt(preparation.amountTokenUnits);
   await topUpBoosterWalletOnTestnet(exactAmount,(message,hash)=>{setStatus(message);if(hash)setTxHash(hash)});
   setStatus("Booster Wallet top-up confirmed");setPreparation(null);setAmount("");await load();
  }catch(reason){setStatus(reason instanceof Error?reason.message:"Booster Wallet top-up failed")}finally{locked.current=false;setBusy(false)}
 }
 if(!data)return <section className="smart-glass-card rounded-[22px] p-5">{error||"Loading Booster..."}</section>;
 const cards=[["Booster Wallet balance",money(data.booster_wallet_balance)],["Active entries",data.active_entries],["Completed entries",data.completed_entries],["Total entries",data.total_entries],["Pending positions",data.pending_positions],["Total Booster income",money(data.total_income)],["C-position refunds",money(data.refunds)]];
 const expected=preparation?(BigInt(data.booster_wallet_balance)+BigInt(preparation.amountTokenUnits)).toString():null;
 return <div className="grid gap-4">
  <section className="smart-glass-card rounded-[22px] p-5"><p className="dash-label">BOOSTER</p><h1 className="mt-1 text-2xl font-bold">Booster</h1><div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">{cards.map(([label,value])=><div className="rounded-xl border border-[#00f77a]/10 bg-black/20 p-3" key={String(label)}><small className="text-[#8b9d94]">{label}</small><b className="mt-1 block text-sm text-[#00f77a]">{value}</b></div>)}</div></section>
  <section className="smart-glass-card rounded-[22px] border-[#00f77a]/20 p-5"><p className="dash-label">NEXT BOOSTER ENTRY</p><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><span className="rounded-xl border border-[#00f77a]/10 bg-black/20 p-3"><small className="block text-[#8b9d94]">Status</small><b className="mt-1 block">{data.boosterActive?`ACTIVE · ${data.eligibility.replaceAll("_"," ")}`:"INACTIVE"}</b></span><span className="rounded-xl border border-[#00f77a]/10 bg-black/20 p-3"><small className="block text-[#8b9d94]">Last booster run</small><b className="mt-1 block text-[10px]">{data.lastRunAt?new Date(data.lastRunAt).toLocaleString():"Not run"}</b></span><span className="col-span-2 rounded-xl border border-[#00f77a]/10 bg-black/20 p-3"><small className="block text-[#8b9d94]">Next booster time</small><b className="mt-1 block text-[10px]">{data.nextEligibleAt?new Date(data.nextEligibleAt).toLocaleString():"Not scheduled"}</b></span></div><div className="mt-4"><BoosterCountdown serverTime={data.server_time} nextEntryAt={data.next_entry_at} eligibility={data.eligibility} onRefresh={load}/></div></section>
  <section className="smart-glass-card rounded-[22px] p-5"><div className="flex items-center gap-2"><Wallet size={16} className="text-[#00f77a]"/><h2 className="font-bold">Booster Wallet top-up</h2></div>
   <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><span className="rounded-xl border border-white/10 bg-black/20 p-3"><small className="text-[#8b9d94]">Current Booster Wallet balance</small><b className="mt-1 block text-[#00f77a]">{money(data.booster_wallet_balance)} USDT</b></span><span className="rounded-xl border border-white/10 bg-black/20 p-3"><small className="text-[#8b9d94]">Available USDT balance</small><b className="mt-1 block">{available?`${money(available)} USDT`:"Check on Add Funds"}</b></span></div>
   <label className="mt-4 block text-xs text-[#8b9d94]">Enter top-up amount<div className="mt-2 flex items-center rounded-xl border border-white/10 bg-black/20 px-3 focus-within:border-[#00f77a]/40"><input ref={input} inputMode="decimal" autoComplete="off" value={amount} onChange={event=>changeAmount(event.target.value)} placeholder="0.00" aria-describedby="booster-amount-error" className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white outline-none"/><b className="text-xs text-[#00f77a]">USDT</b></div></label>
   <div className="mt-3 grid grid-cols-3 gap-2">{quick.map(value=><button type="button" onClick={()=>{setAmount(value);setAmountError("")}} className="rounded-xl border border-[#00f77a]/15 bg-[#00f77a]/5 py-2 text-[10px] text-[#00f77a]" key={value}>${value}</button>)}<button type="button" onClick={()=>{setAmount("");setAmountError("");input.current?.focus()}} className="rounded-xl border border-[#00f77a]/15 bg-[#00f77a]/5 py-2 text-[10px] text-[#00f77a]">Custom</button></div>
   {amountError&&<p id="booster-amount-error" role="alert" className="mt-3 text-xs text-[#e9ad45]">{amountError}</p>}
   <p className="mt-3 text-[10px] text-[#8b9d94]">Gas is paid separately in tBNB/BNB. No top-up runs automatically.</p>
   <button type="button" disabled={busy} onClick={()=>void prepare()} className="mt-3 w-full rounded-xl bg-[#00f77a] p-3 text-xs font-bold text-black disabled:opacity-50">{busy?"Checking…":"Add Funds"}</button>
   {status&&<p role="status" className="mt-3 break-words text-xs text-[#8b9d94]">{status}</p>}{txHash&&<p className="mt-1 break-all text-[10px] text-[#8b9d94]">Transaction: {txHash}</p>}
  </section>
  {preparation&&<div className="booster-confirm-backdrop" role="dialog" aria-modal="true" aria-label="Confirm Booster top-up"><section className="smart-glass-card booster-confirm-card"><p className="dash-label">CONFIRM TOP-UP</p><h2>Review Booster Wallet funding</h2><div><span>Top-up amount<b>{money(preparation.amountTokenUnits)} USDT</b></span><span>Current balance<b>{money(data.booster_wallet_balance)} USDT</b></span><span>Expected new balance<b>{money(expected!)} USDT</b></span><span>Network<b>{preparation.network}</b></span><span>Gas<b>Paid separately in {preparation.gasCurrency}</b></span></div><div className="grid grid-cols-2 gap-2"><button type="button" disabled={busy} onClick={()=>setPreparation(null)}>Cancel</button><button type="button" disabled={busy} onClick={()=>void confirm()}>{busy?"Processing…":"Confirm"}</button></div></section></div>}
  <div className="grid gap-3 md:grid-cols-2">{data.entries.map(entry=><article className="smart-glass-card matrix-history-host rounded-[22px] p-5" key={entry.id}><MatrixHistoryMenu module="BOOSTER" entryId={entry.id} title={`Booster entry #${entry.cycle_number}`}/><div className="flex justify-between"><b>Booster entry #{entry.cycle_number}</b><span className="text-[10px] text-[#00f77a]">{entry.status}</span></div><div className="mt-4 grid grid-cols-3 gap-2">{[1,2,3].map(slot=>{const position=entry.positions.find(value=>value.slotNumber===slot);return <div className={`min-w-0 rounded-xl border p-3 text-center text-[9px] ${position?"border-[#00f77a]/30 bg-[#00f77a]/5":"border-dashed border-white/10"}`} key={slot}><b className="block">{["A","B","C"][slot-1]}</b><span className="block truncate text-[#8b9d94]">{position?.wallet||"Empty"}</span></div>})}</div></article>)}</div>
  <History title="Booster Wallet history" rows={data.walletHistory.map(value=>({id:value.id,event:value.reason,amount:`${value.direction==="DEBIT"?"-":"+"}${money(value.amount)}`,date:value.created_at}))}/>
  <History title="Booster top-up history" rows={(data.topUpHistory||[]).map(value=>({id:value.id,event:`${value.status} · ${value.tx_hash}${value.previous_balance&&value.new_balance?` · ${money(value.previous_balance)} → ${money(value.new_balance)} USDT`:""}`,amount:`+${money(value.amount)}`,date:value.created_at}))}/>
  <History title="Booster entry history" rows={data.entryHistory.map(value=>({id:value.id,event:`${value.type} ${value.slot_number||""}`,amount:money(value.amount),date:value.created_at}))}/>
  <button onClick={()=>void load()} className="flex items-center gap-2 text-xs text-[#00f77a]"><RefreshCw size={14}/>Refresh Booster</button>
 </div>
}
function History({title,rows}:{title:string;rows:{id:string;event:string;amount:string;date:string}[]}){return <section className="smart-glass-card overflow-hidden rounded-[22px] p-5"><div className="flex items-center gap-2"><Clock size={15}/><h2 className="font-bold">{title}</h2></div><div className="mt-3 max-h-72 overflow-auto">{rows.map(row=><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-white/5 py-3 text-xs" key={row.id}><span className="min-w-0 break-all">{row.event}<small className="block text-[#8b9d94]">{new Date(row.date).toLocaleString()}</small></span><b className="text-[#00f77a]">{row.amount}</b></div>)}{!rows.length&&<p className="text-xs text-[#8b9d94]">No history yet.</p>}</div></section>}
