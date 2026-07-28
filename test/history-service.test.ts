import { describe, expect, it, vi } from "vitest";
import {
  blockchainHistoryKey, internalHistoryKey, recordHistory,
} from "@/lib/server/history-service";

const wallet="0x1234567890abcdef1234567890abcdef12345678";

describe("activity history writer",()=>{
 it("derives stable internal and blockchain idempotency keys",()=>{
  expect(internalHistoryKey("package_purchases","record-1","PACKAGE_PURCHASED",wallet))
   .toBe(`package_purchases:record-1:PACKAGE_PURCHASED:${wallet}`);
  expect(blockchainHistoryKey(97,`0x${"AB".repeat(32)}`,4,"PACKAGE_PURCHASED",wallet.toUpperCase()))
   .toBe(`97:0x${"ab".repeat(32)}:4:PACKAGE_PURCHASED:${wallet}`);
 });
 it("uses ON CONFLICT to make retries exactly-once and lowercases wallets",async()=>{
  const query=vi.fn().mockResolvedValue({rows:[]});
  const result=await recordHistory({query} as never,{
   userWallet:wallet.toUpperCase(),category:"DIRECT_INCOME",eventType:"DIRECT_INCOME_CREDITED",
   title:"Direct income received",amount:"3.20",direction:"CREDIT",sourceWallet:wallet.toUpperCase(),
   status:"CONFIRMED",sourceTable:"direct_income_ledger",sourceRecordId:"record-1",
   idempotencyKey:internalHistoryKey("direct_income_ledger","record-1","DIRECT_INCOME_CREDITED",wallet),
   occurredAt:"2026-07-28T10:00:00Z",
  });
  expect(result).toEqual({id:null,duplicate:true});
  expect(query.mock.calls[0][0]).toContain("ON CONFLICT(idempotency_key) DO NOTHING");
  expect(query.mock.calls[0][1][0]).toBe(wallet);
  expect(query.mock.calls[0][1][9]).toBe(wallet);
 });
 it("refuses removed X4 event types",async()=>{
  await expect(recordHistory({query:vi.fn()} as never,{
   userWallet:wallet,category:"WALLET",eventType:"X4_INCOME",title:"Removed",status:"CONFIRMED",
   sourceTable:"x4_income_history",sourceRecordId:"1",idempotencyKey:"removed",occurredAt:new Date(),
  })).rejects.toThrow("X4 history is not approved");
 });
});
