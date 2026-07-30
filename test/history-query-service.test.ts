import { beforeEach, describe, expect, it, vi } from "vitest";
const query=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/server/db",()=>({query}));
import { getHistory } from "@/lib/server/history-query-service";

const wallet="0x1234567890abcdef1234567890abcdef12345678";
const row=(index:number)=>({
 id:"10000000-0000-0000-0000-"+String(index).padStart(12,"0"),category:"DIRECT_INCOME",
 event_type:"DIRECT_INCOME_CREDITED",title:"Direct income received",description:null,amount:"3.200000000000000000",
 currency:"USDT",direction:"CREDIT",source_wallet:"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
 sponsor_wallet:wallet,referral_level:1,package_number:3,package_amount:"32.000000000000000000",
 matrix_type:null,matrix_package_number:null,cycle_number:null,recycle_number:null,position_number:null,
 previous_balance:null,new_balance:null,fee_amount:null,net_amount:null,status:"CONFIRMED",
 tx_hash:`0x${String(index).padStart(64,"0")}`,block_number:"100",log_index:2,
 source_table:"direct_income_ledger",source_record_id:String(index),metadata:{},
 occurred_at:new Date(Date.UTC(2026,0,1,0,0,30-index)),created_at:new Date(Date.UTC(2026,0,1,0,0,30-index)),
});

describe("database-backed history read model",()=>{
 beforeEach(()=>query.mockReset());
 it("returns normalized source, package and transaction fields",async()=>{
  query.mockResolvedValueOnce({rows:[row(1)]});
  const result=await getHistory(wallet);
  expect(result.items[0]).toMatchObject({
   category:"DIRECT_INCOME",eventType:"DIRECT_INCOME_CREDITED",amount:"3.200000000000000000",
   packageAmount:"32.000000000000000000",sourceWallet:"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
   packageNumber:3,status:"CONFIRMED",
  });
 });
 it("uses occurredAt plus UUID for opaque cursor pagination",async()=>{
  query.mockResolvedValueOnce({rows:Array.from({length:21},(_,index)=>row(index))});
  const first=await getHistory(wallet);
  expect(first.items).toHaveLength(20);expect(first.nextCursor).toBeTruthy();
  query.mockResolvedValueOnce({rows:[]});
  await getHistory(wallet,{cursor:first.nextCursor});
  expect(query.mock.calls[1][1][9]).toBeTruthy();
  expect(query.mock.calls[1][1][10]).toBe(first.items[19].id);
 });
 it("applies every supported filter after wallet authorization",async()=>{
  query.mockResolvedValueOnce({rows:[]});
  await getHistory(wallet,{category:"direct_income",eventType:"direct_income_credited",status:"confirmed",
   fromDate:"2026-01-01",toDate:"2026-01-31",sourceWallet:"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
   txHash:`0x${"ab".repeat(32)}`,packageNumber:3,limit:200});
  expect(query.mock.calls[0][1]).toEqual([
   wallet,"DIRECT_INCOME","DIRECT_INCOME_CREDITED","CONFIRMED",expect.any(Date),expect.any(Date),
   "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",`0x${"ab".repeat(32)}`,3,null,null,101,
  ]);
  expect(String(query.mock.calls[0][0])).toContain("lower(user_wallet)=lower($1)");
 });
 it("rejects removed categories before querying",async()=>{
  await expect(getHistory(wallet,{category:"X4"})).rejects.toMatchObject({code:"INVALID_CATEGORY"});
  expect(query).not.toHaveBeenCalled();
 });
});
