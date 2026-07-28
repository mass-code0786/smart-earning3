import { beforeEach, describe, expect, it, vi } from "vitest";
const query=vi.fn();
vi.mock("@/lib/server/db",()=>({query}));

describe("Booster timing read model",()=>{
 beforeEach(()=>{query.mockReset();vi.useFakeTimers();vi.setSystemTime(new Date("2026-07-28T10:00:00Z"))});
 it("exposes persisted last/next timestamps and server-derived remaining seconds",async()=>{
  query
   .mockResolvedValueOnce({rows:[{id:"u1"}]})
   .mockResolvedValueOnce({rows:[{balance:"2500000",package_credits:"2500000",manual_top_ups:"0",refunds:"0",deductions:"0"}]})
   .mockResolvedValueOnce({rows:[{last_entry_at:"2026-07-28T10:00:00Z",next_entry_at:"2026-07-28T15:00:00Z"}]})
   .mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]})
   .mockResolvedValueOnce({rows:[{total_entries:0,active_entries:0,completed_entries:0,total_income:"0",pending_positions:0}]});
  const{getBoosterDashboard}=await import("@/lib/server/booster-query-service");
  await expect(getBoosterDashboard("0x1234567890abcdef1234567890abcdef12345678")).resolves.toMatchObject({
   boosterActive:true,lastRunAt:"2026-07-28T10:00:00Z",nextEligibleAt:"2026-07-28T15:00:00Z",
   remainingSeconds:18000,eligibility:"NOT_DUE",
  });
 });
});
