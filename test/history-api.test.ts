import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const requireSession=vi.fn(),getHistory=vi.fn();
vi.mock("@/lib/server/auth",()=>({requireSession}));
vi.mock("@/lib/server/history-query-service",()=>({getHistory}));

describe("GET /api/history authorization",()=>{
 beforeEach(()=>{vi.clearAllMocks();getHistory.mockResolvedValue({items:[],nextCursor:null})});
 it("scopes history to the authenticated session wallet",async()=>{
  requireSession.mockResolvedValue({wallet:"0x1234567890abcdef1234567890abcdef12345678"});
  const{GET}=await import("@/app/api/history/route");
  const response=await GET(new NextRequest("http://localhost/api/history?category=DIRECT_INCOME&eventType=DIRECT_INCOME_CREDITED&sourceWallet=0x1234567890abcdef1234567890abcdef12345678&packageNumber=3&limit=20"));
  expect(response.status).toBe(200);
  expect(getHistory).toHaveBeenCalledWith("0x1234567890abcdef1234567890abcdef12345678",expect.objectContaining({
   category:"DIRECT_INCOME",eventType:"DIRECT_INCOME_CREDITED",
   sourceWallet:"0x1234567890abcdef1234567890abcdef12345678",packageNumber:3,limit:20,
  }));
 });
 it("does not query history when authentication fails",async()=>{
  requireSession.mockRejectedValue(new Error("unauthorized"));
  const{GET}=await import("@/app/api/history/route");
  const response=await GET(new NextRequest("http://localhost/api/history"));
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(getHistory).not.toHaveBeenCalled();
 });
});
