import { beforeEach, describe, expect, it, vi } from "vitest";
const query=vi.fn();
vi.mock("@/lib/server/db",()=>({query}));

const wallet="0x1234567890abcdef1234567890abcdef12345678";
const row=(index:number)=>({
 id:`direct-income:${String(index).padStart(2,"0")}`,type:"DIRECT_INCOME",category:"INCOME",
 amount:"3200000",currency:"USDT",source_wallet:"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
 package_amount:"32000000",package_id:3,matrix_type:null,cycle:null,recycle_count:null,status:"CONFIRMED",
 tx_hash:`0x${String(index).padStart(64,"0")}`,created_at:new Date(Date.UTC(2026,0,1,0,0,30-index)),
 description:"Direct income received from referral",income_type:"DIRECT_INCOME",level:null,position:null,metadata:{},
});

describe("unified history read model",()=>{
 beforeEach(()=>query.mockReset());
 it("normalizes income source, package and transaction fields",async()=>{
  query.mockResolvedValueOnce({rows:[row(1)]});
  const{getHistory}=await import("@/lib/server/history-query-service");
  const result=await getHistory(wallet);
  expect(result.items[0]).toMatchObject({type:"DIRECT_INCOME",amount:"3.20",packageAmount:"32.00",sourceWallet:"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",packageId:3,incomeType:"DIRECT_INCOME",status:"CONFIRMED"});
 });
 it("uses opaque cursor pagination with default limit 20",async()=>{
  query.mockResolvedValueOnce({rows:Array.from({length:21},(_,index)=>row(index))});
  const{getHistory}=await import("@/lib/server/history-query-service");
  const first=await getHistory(wallet);
  expect(first.items).toHaveLength(20);expect(first.nextCursor).toBeTruthy();
  query.mockResolvedValueOnce({rows:[]});
  await getHistory(wallet,{cursor:first.nextCursor});
  expect(query.mock.calls[1][1][6]).toBeTruthy();
  expect(query.mock.calls[1][1][7]).toBe(first.items[19].id);
 });
 it.each([
  ["package_purchases","package history"],["registrations","referral history"],["x3_recycle_events","X3 recycle history"],
  ["x4_recycle_history","X4 recycle history"],["autopool_income_history","autopool history"],
  ["booster_scheduler_history","booster history"],["daily_dividend_allocations","dividend history"],
  ["auto_withdrawals","withdrawal history"],["income_wallet_ledger","wallet history"],
 ])("queries %s for %s",async(table)=>{
  query.mockResolvedValueOnce({rows:[]});
  const{getHistory}=await import("@/lib/server/history-query-service");
  await getHistory(wallet);
  expect(String(query.mock.calls.at(-1)?.[0])).toContain(table);
 });
 it("applies category, status, dates and search without changing authorization scope",async()=>{
  query.mockResolvedValueOnce({rows:[]});
  const{getHistory}=await import("@/lib/server/history-query-service");
  await getHistory(wallet,{category:"matrix",status:"completed",search:"0xabc",from:"2026-01-01",to:"2026-01-31"});
  expect(query.mock.calls[0][1].slice(0,6)).toEqual([wallet,"MATRIX","COMPLETED","0xabc",expect.any(Date),expect.any(Date)]);
  expect(String(query.mock.calls[0][0])).toContain("JOIN viewer v");
 });
 it.each([
  ["DIRECT_INCOME","DIRECT_INCOME"],["MAGIC_LEVEL","MAGIC_LEVEL_INCOME"],
  ["X3","X3"],["X4","X4"],["BOOSTER_INCOME","BOOSTER_INCOME"],
 ])("maps menu filter %s to the read-only type filter %s",async(category,typeFilter)=>{
  query.mockResolvedValueOnce({rows:[]});
  const{getHistory}=await import("@/lib/server/history-query-service");
  await getHistory(wallet,{category});
  expect(query.mock.calls.at(-1)?.[1][1]).toBeNull();
  expect(query.mock.calls.at(-1)?.[1][9]).toBe(typeFilter);
 });
});
