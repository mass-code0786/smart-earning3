import{describe,expect,it}from"vitest";import{Interface}from"ethers";import{readFileSync}from"node:fs";import{resolve}from"node:path";
import{boosterBalance,boosterPackageCredit,boosterScheduledFor,BOOSTER_ENTRY_COST,BOOSTER_INCOME}from"@/lib/server/booster-math";
import{findBoosterTransfer,findConfirmedBoosterTopUp}from"@/lib/server/booster-service";
describe("Booster exact arithmetic",()=>{
 it("credits exactly 31.25% for all eight packages",()=>{for(const dollars of[8n,16n,32n,64n,128n,256n,512n,1024n])
  expect(boosterPackageCredit(dollars*1_000_000n)).toBe(dollars*312_500n)});
 it("uses exact entry and position amounts",()=>{expect(BOOSTER_ENTRY_COST).toBe(2_500_000n);expect(BOOSTER_INCOME).toBe(2_000_000n)});
 it("derives balance only from credits and debits",()=>expect(boosterBalance([{direction:"CREDIT",amount:"5000000"},{direction:"DEBIT",amount:"2500000"}])).toBe(2_500_000n));
 it("uses five hours from the last successful entry",()=>{const last=new Date("2026-01-01T00:00:00Z");
  expect(boosterScheduledFor(last,new Date()).toISOString()).toBe("2026-01-01T05:00:00.000Z")});
});
describe("Booster Wallet top-up evidence",()=>{
 it("accepts only the configured token, sender and recipient",()=>{
  const iface=new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
  const token="0x0000000000000000000000000000000000000001",from="0x0000000000000000000000000000000000000002",to="0x0000000000000000000000000000000000000003";
  const event=iface.encodeEventLog(iface.getEvent("Transfer")!,[from,to,5_000_000n]);
  expect(findBoosterTransfer([{address:token,topics:event.topics,data:event.data}],token,from,to)).toBe(5_000_000n);
  expect(findBoosterTransfer([{address:token,topics:event.topics,data:event.data}],token,to,from)).toBeNull();
 });
 it("requires the unified contract Booster event and preserves its source reference",()=>{
  const iface=new Interface(["event BoosterTopup(address indexed user,uint256 amount,bytes32 indexed sourceReference)"]);
  const contract="0x0000000000000000000000000000000000000001",user="0x0000000000000000000000000000000000000002";
  const source="0x"+"12".repeat(32),event=iface.encodeEventLog(iface.getEvent("BoosterTopup")!,[user,5_000_000n,source]);
  const found=findConfirmedBoosterTopUp([{address:contract,topics:event.topics,data:event.data}],contract,user);
  expect(found.topUp).toEqual({amount:5_000_000n,sourceReference:source});
 });
});
describe("Booster naming and isolation",()=>{
 it("contains none of the forbidden alternative names",()=>{
  const files=["app/booster/page.tsx","components/booster-page.tsx","components/booster-admin-panel.tsx",
   "lib/server/booster-service.ts","lib/server/booster-query-service.ts","database/migrations/011_booster.sql"];
  const text=files.map(f=>readFileSync(resolve(process.cwd(),f),"utf8")).join("\n");
  const forbiddenNames=[["X3 Global ","Booster Income"],["Global ","Booster Matrix"],["Booster Activation ","Wallet"],
    ["Booster Distribution ","Wallet"],["Booster Income ","Wallet"],["Booster Pool ","Wallet"]].map(x=>x.join(""));
  for(const forbidden of forbiddenNames)
   expect(text).not.toContain(forbidden);
 });
});
