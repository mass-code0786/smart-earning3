"use client";
import{useCallback,useEffect,useRef,useState}from"react";

export type BoosterEligibility="NOT_DUE"|"DUE"|"PROCESSING"|"INSUFFICIENT_BALANCE"|"ENTRY_CREATED"|"ERROR";
type Props={
 serverTime:string;nextEntryAt:string|null;eligibility:BoosterEligibility;
 onRefresh:()=>Promise<void>;pollMilliseconds?:number;
};
const format=(milliseconds:number)=>{
 const seconds=Math.max(0,Math.ceil(milliseconds/1000));
 const hours=Math.floor(seconds/3600).toString().padStart(2,"0");
 const minutes=Math.floor(seconds%3600/60).toString().padStart(2,"0");
 const remainder=(seconds%60).toString().padStart(2,"0");
 return`${hours} : ${minutes} : ${remainder}`;
};
export function synchronizedRemaining(nextEntryAt:string,serverTime:string,elapsedMilliseconds:number){
 return Math.max(0,new Date(nextEntryAt).getTime()-new Date(serverTime).getTime()-elapsedMilliseconds);
}
export function BoosterCountdown({serverTime,nextEntryAt,eligibility,onRefresh,pollMilliseconds=10_000}:Props){
 const synchronizedAt=useRef(Date.now()),refreshing=useRef(false);
 const initial=nextEntryAt?synchronizedRemaining(nextEntryAt,serverTime,0):0;
 const[remaining,setRemaining]=useState(initial);
 const normalizedStatus=eligibility==="ENTRY_CREATED"&&nextEntryAt?"NOT_DUE":eligibility;
 const[localStatus,setLocalStatus]=useState<BoosterEligibility>(normalizedStatus);
 const refresh=useCallback(async()=>{
  if(refreshing.current)return;refreshing.current=true;
  try{await onRefresh()}finally{refreshing.current=false}
 },[onRefresh]);
 useEffect(()=>{
  synchronizedAt.current=Date.now();
  setRemaining(nextEntryAt?synchronizedRemaining(nextEntryAt,serverTime,0):0);
  setLocalStatus(eligibility==="ENTRY_CREATED"&&nextEntryAt?"NOT_DUE":eligibility);
 },[serverTime,nextEntryAt,eligibility]);
 useEffect(()=>{
  const tick=()=>{
   if(!nextEntryAt||localStatus!=="NOT_DUE")return;
   const value=synchronizedRemaining(nextEntryAt,serverTime,Date.now()-synchronizedAt.current);
   setRemaining(value);if(value===0)setLocalStatus("PROCESSING");
  };
  tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);
 },[nextEntryAt,serverTime,localStatus]);
 useEffect(()=>{
  if(!["DUE","PROCESSING"].includes(localStatus))return;
  void refresh();const timer=setInterval(()=>void refresh(),pollMilliseconds);return()=>clearInterval(timer);
 },[localStatus,pollMilliseconds,refresh]);
 useEffect(()=>{
  const visible=()=>{if(document.visibilityState==="visible")void refresh()};
  document.addEventListener("visibilitychange",visible);return()=>document.removeEventListener("visibilitychange",visible);
 },[refresh]);
 if(localStatus==="INSUFFICIENT_BALANCE")return <p className="text-sm font-semibold text-[#e9ad45]">Insufficient Booster Wallet balance</p>;
 if(localStatus==="DUE"||localStatus==="PROCESSING")return <p className="text-sm font-semibold text-[#00f77a]">Processing...</p>;
 if(localStatus==="ERROR")return <div><p className="text-sm text-red-300">Booster status unavailable</p><button onClick={()=>void refresh()} className="mt-2 text-xs text-[#00f77a]">Retry</button></div>;
 if(!nextEntryAt)return <p className="text-sm text-[#8b9d94]">Next Booster entry is not scheduled</p>;
 return <p aria-label="Next Booster Entry countdown" className="font-mono text-2xl font-bold tracking-[.12em] text-[#00f77a]">{format(remaining)}</p>;
}
