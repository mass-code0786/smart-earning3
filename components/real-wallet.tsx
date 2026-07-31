"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Wallet } from "lucide-react";
import { BoosterCountdown, type BoosterEligibility } from "@/components/booster-countdown";
import { formatTokenUnits } from "@/lib/client/money";

type Financial = {
  income_wallet:string;income_reserved:string;total_withdrawn:string;hold_wallet:string;
  booster_wallet:string;dividend_income:string;gross_earned:string;cap_used:string;
  cap_remaining:string;active_package:string;
};
type Dashboard = { wallet_address:string;direct_count:number;magicBalance:string;financial:Financial };
type Booster = { server_time:string;next_entry_at:string|null;eligibility:BoosterEligibility;booster_wallet_balance:string };
type WalletSnapshot = {
  authenticatedWallet:string;
  user:Dashboard;
  booster:Booster;
  currentPackage:{packageId:number;name:string}|null;
  team:{totalTeam:number};
};

const shortWallet=(value:string)=>`${value.slice(0,6)}…${value.slice(-4)}`;
const money=(value:string)=>`${formatTokenUnits(value)} USDT`;

export default function RealWallet(){
 const[data,setData]=useState<WalletSnapshot|null>(null),[error,setError]=useState(""),[copied,setCopied]=useState(false);
 const load=useCallback(async(signal?:AbortSignal)=>{
  setError("");
  try{
   const response=await fetch("/api/wallet",{cache:"no-store",credentials:"same-origin",signal});
   const body=await response.json();
   if(!response.ok||!body.user||typeof body.authenticatedWallet!=="string"||
      body.authenticatedWallet.toLowerCase()!==body.user.wallet_address.toLowerCase()){
    throw new Error("Wallet data could not be loaded");
   }
   setData(body);
  }catch(reason){
   if(signal?.aborted)return;
   setData(null);
   setError(reason instanceof Error?reason.message:"Wallet data could not be loaded");
  }
 },[]);
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort()},[load]);
 if(!data)return <section className="smart-glass-card rounded-[20px] p-5 text-sm text-[#8b9d94]">{error||"Loading Wallet…"}</section>;
 const financial=data.user.financial;
 const section=(title:string,items:[string,string,boolean?][])=><section className="wallet-summary-section"><h2>{title}</h2><div className="wallet-summary-grid">{items.map(([label,value,accent])=><article className="smart-glass-card wallet-summary-item" key={label}><small>{label}</small><b className={accent?"text-[#00f77a]":""}>{value}</b>{label==="Booster Wallet"&&<BoosterCountdown serverTime={data.booster.server_time} nextEntryAt={data.booster.next_entry_at} eligibility={data.booster.eligibility} onRefresh={load} compact/>}</article>)}</div></section>;
 return <div className="wallet-summary-page">
  <section className="smart-glass-card wallet-auth-card"><Wallet size={19} className="text-[#00f77a]"/><div><small>Authenticated Wallet</small><b>{shortWallet(data.user.wallet_address)}</b></div><button type="button" aria-label="Copy wallet address" onClick={()=>void navigator.clipboard.writeText(data.user.wallet_address).then(()=>setCopied(true))}><Copy size={15}/></button>{copied&&<span role="status">Copied</span>}</section>
  {section("Wallet Balances",[["Income Wallet",money(financial.income_wallet),true],["Magic Wallet",money(data.user.magicBalance)],["X3 Hold Wallet",money(financial.hold_wallet)],["Booster Wallet",money(data.booster.booster_wallet_balance)]])}
  {section("Earnings and Withdrawals",[["Total Earned",money(financial.gross_earned),true],["Total Withdrawn",money(financial.total_withdrawn)],["Pending Withdrawal",money(financial.income_reserved)],["Dividend Income",money(financial.dividend_income)]])}
  {section("Capping and Package",[["5X Cap Used",money(financial.cap_used)],["5X Cap Remaining",money(financial.cap_remaining),true],["Active Package Value",money(financial.active_package)],["Current Package",data.currentPackage?`${data.currentPackage.name} · #${data.currentPackage.packageId}`:"No package"]])}
  {section("Team Snapshot",[["Direct Members",String(data.user.direct_count)],["Total Team",String(data.team.totalTeam)]])}
 </div>
}
