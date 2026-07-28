import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const requireSession=vi.fn(),prepareBoosterTopUp=vi.fn();
vi.mock("@/lib/server/auth",()=>({requireSession}));
vi.mock("@/lib/server/booster-service",()=>({prepareBoosterTopUp}));
vi.mock("@/lib/server/http",async(importOriginal)=>{
 const actual=await importOriginal<any>();return{...actual,assertSameOrigin:vi.fn()};
});
describe("Booster top-up preparation API",()=>{
 beforeEach(()=>{vi.clearAllMocks();requireSession.mockResolvedValue({wallet:"0x1234567890abcdef1234567890abcdef12345678"});prepareBoosterTopUp.mockResolvedValue({amountTokenUnits:"5000000",availableBalanceTokenUnits:"10000000"})});
 it("passes an arbitrary positive token-unit amount to read-only preparation",async()=>{
  const{POST}=await import("@/app/api/booster/top-up/prepare/route");
  const request=new NextRequest("http://localhost/api/booster/top-up/prepare",{method:"POST",body:JSON.stringify({amountTokenUnits:"5000000"}),headers:{"content-type":"application/json"}});
  expect((await POST(request)).status).toBe(200);
  expect(prepareBoosterTopUp).toHaveBeenCalledWith(expect.any(String),5_000_000n);
 });
 it("rejects zero before calling the preparation service",async()=>{
  const{POST}=await import("@/app/api/booster/top-up/prepare/route");
  const request=new NextRequest("http://localhost/api/booster/top-up/prepare",{method:"POST",body:JSON.stringify({amountTokenUnits:"0"}),headers:{"content-type":"application/json"}});
  expect((await POST(request)).status).toBe(400);
  expect(prepareBoosterTopUp).not.toHaveBeenCalled();
 });
});
